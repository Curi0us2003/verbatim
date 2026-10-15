"""Voice analysis: a second layer for deciding who said what.

Overlapping 1.5-second "voice fingerprints" (speaker embeddings from the free, ungated
pyannote/wespeaker-voxceleb-resnet34-LM model: no Hugging Face token needed) are taken every
0.5 seconds. They are grouped into the session's two voices, every word is scored against both,
and the sequence is smoothed so the speaker only changes where the voice clearly changes. Then:

- without pyannote speaker separation, the voices decide who said what;
- with it, they double-check pyannote: a clear disagreement is corrected, an unclear one is flagged
  so the counsellor can check it;
- if the counsellor has saved their own voiceprint, the matching voice is the counsellor.

Every word gets `speaker` and `spk_conf` (0.5 = could be either voice, 1.0 = clearly one voice).
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .. import storage
from ..config import settings
from .audio import SAMPLE_RATE
from .transcribe import Progress, model_dir, prepare_torch, resolve_device

log = logging.getLogger("verbatim.voices")

WINDOW_SEC = 1.5  # length of each fingerprint
HOP_SEC = 0.5  # a new fingerprint every half second
MIN_EMBED_SEC = 0.5  # spans shorter than this are not fingerprinted
SPEECH_COVERAGE = 0.7  # windows used to learn the two voices must be at least 70% speech
MIN_AGREEMENT = 0.7  # if voices and pyannote broadly disagree, the voice grouping is not trusted
SAME_VOICE_SIM = 0.80  # two voice centres more similar than this = probably one person only
SWITCH_PENALTY = 3.0  # cost of changing speaker between words that follow each other closely
SWITCH_PENALTY_AFTER_PAUSE = 1.0  # ...and after a pause, where speaker changes usually happen
PAUSE_SEC = 0.3
SCORE_SCALE = 10.0
CORRECT_MARGIN = 0.10  # voice must favour the other speaker by this much to overrule pyannote
MIN_CORRECT_SEC = 0.8  # ...over at least this much speech
UNSURE_BELOW = 0.65  # turns below this speaker confidence get a "check speaker" flag
VOICEPRINT_MIN_SIM = 0.45  # the counsellor's voiceprint must be at least this similar...
VOICEPRINT_MIN_GAP = 0.08  # ...and this much closer to one voice than the other

_lock = threading.Lock()
_models: dict[tuple[str, str], object] = {}


# ---------------------------------------------------------------------------
# Fingerprints
# ---------------------------------------------------------------------------


def _inference(device: str, window: str):
    with _lock:
        key = (device, window)
        if key not in _models:
            prepare_torch()
            import torch
            from pyannote.audio import Inference, Model

            model = Model.from_pretrained(settings.voice_model, cache_dir=model_dir("pyannote"))
            if window == "whole":
                _models[key] = Inference(model, window="whole", device=torch.device(device))
            else:
                _models[key] = Inference(
                    model, window="sliding", duration=WINDOW_SEC, step=HOP_SEC, batch_size=32,
                    device=torch.device(device),
                )
        return _models[key]


def _unit_rows(m: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(m, axis=1, keepdims=True)
    norms[~np.isfinite(norms) | (norms == 0)] = 1.0
    return np.nan_to_num(m / norms)


def _unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n > 0 else v


def embed(audio: np.ndarray, spans: list[tuple[float, float]], device: str | None = None) -> list[np.ndarray | None]:
    """Unit-length voice fingerprint for each (start, end) span; None for spans too short to judge."""
    import torch

    inference = _inference(device or resolve_device(), "whole")
    wave = torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32))[None]
    out: list[np.ndarray | None] = []
    for start, end in spans:
        if end - start < MIN_EMBED_SEC:
            out.append(None)
            continue
        piece = wave[:, int(start * SAMPLE_RATE) : int(end * SAMPLE_RATE)]
        vec = np.asarray(inference({"waveform": piece, "sample_rate": SAMPLE_RATE}), dtype=np.float32).reshape(-1)
        norm = float(np.linalg.norm(vec))
        out.append(vec / norm if norm > 0 and np.isfinite(norm) else None)
    return out


def window_fingerprints(audio: np.ndarray, device: str) -> tuple[np.ndarray, np.ndarray]:
    """Fingerprints of overlapping windows over the whole recording → (vectors, window centre times)."""
    import torch

    if len(audio) < WINDOW_SEC * SAMPLE_RATE:
        return np.zeros((0, 1), np.float32), np.zeros(0)
    wave = torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32))[None]
    feats = _inference(device, "sliding")({"waveform": wave, "sample_rate": SAMPLE_RATE})
    data = np.asarray(feats.data, dtype=np.float32)
    sw = feats.sliding_window
    centres = sw.start + np.arange(len(data)) * sw.step + sw.duration / 2
    return _unit_rows(data), centres


# ---------------------------------------------------------------------------
# Grouping into two voices
# ---------------------------------------------------------------------------


MIN_GROUP_SHARE = 0.15  # a "voice" with less speech than this is more likely odd windows than a person


def _polish(vectors: np.ndarray, labels: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """A few rounds of k-means on the unit sphere starting from `labels`."""
    for _ in range(20):
        centres = np.stack([
            _unit(vectors[labels == k].sum(0)) if np.any(labels == k) else vectors[0] for k in (0, 1)
        ])
        new = np.argmax(vectors @ centres.T, axis=1)
        if np.array_equal(new, labels):
            break
        labels = new
    return labels, centres


def two_voices(vectors: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Cluster unit vectors into 2 groups → (labels, unit centres).

    Two methods are tried and the better split is kept: agglomerative clustering can split off a
    handful of odd windows (turn edges, coughs) instead of the second person; k-means is steadier
    but can be fooled by uneven talk time. Splits that leave one "voice" with under 15% of the
    speech are distrusted.
    """
    from sklearn.cluster import AgglomerativeClustering, KMeans

    if len(vectors) > 1500:  # keep the clustering quick on long sessions
        vectors = vectors[np.linspace(0, len(vectors) - 1, 1500).astype(int)]
    candidates = [
        AgglomerativeClustering(n_clusters=2, metric="cosine", linkage="average").fit_predict(vectors),
        KMeans(n_clusters=2, n_init=10, random_state=0).fit_predict(vectors),
    ]
    best, best_score = None, -np.inf
    for start in candidates:
        labels, centres = _polish(vectors, start)
        share = min(np.mean(labels == 0), np.mean(labels == 1))
        separation = 1.0 - float(centres[0] @ centres[1])
        score = separation - (1.0 if share < MIN_GROUP_SHARE else 0.0)
        if score > best_score:
            best, best_score = (labels, centres), score
    return best


def smooth(scores: np.ndarray, gaps: np.ndarray) -> np.ndarray:
    """Best speaker sequence (Viterbi): follow the voice scores, but changing speaker costs extra,
    less so after a pause. scores: (n_words, 2) similarities; gaps: pause before each word (s)."""
    n = len(scores)
    total = np.zeros((n, 2))
    back = np.zeros((n, 2), dtype=int)
    total[0] = scores[0] * SCORE_SCALE
    for t in range(1, n):
        penalty = SWITCH_PENALTY_AFTER_PAUSE if gaps[t] >= PAUSE_SEC else SWITCH_PENALTY
        for s in (0, 1):
            stay, switch = total[t - 1, s], total[t - 1, 1 - s] - penalty
            back[t, s] = s if stay >= switch else 1 - s
            total[t, s] = max(stay, switch) + scores[t, s] * SCORE_SCALE
    path = np.zeros(n, dtype=int)
    path[-1] = int(np.argmax(total[-1]))
    for t in range(n - 1, 0, -1):
        path[t - 1] = back[t, path[t]]
    return path


def _confidence(margin: float) -> float:
    """0.5 = could be either voice; 1.0 = clearly this voice; below 0.5 = the other voice fits better."""
    return round(min(1.0, max(0.0, 0.5 + margin * 2.5)), 3)


# ---------------------------------------------------------------------------
# Counsellor voiceprint (optional, stored encrypted; no audio is kept)
# ---------------------------------------------------------------------------


def _voiceprint_path() -> Path:
    return settings.data_path / storage.stored_name("voiceprint.json")


def load_voiceprint() -> dict | None:
    for name in ("voiceprint.json.enc", "voiceprint.json"):
        path = settings.data_path / name
        if path.exists():
            try:
                data = json.loads(storage.read_bytes(path))
            except Exception:
                log.warning("Could not read the saved voiceprint")
                return None
            if data.get("model") != settings.voice_model:
                return None  # made with a different model: not comparable
            return data
    return None


def save_voiceprint(vec: np.ndarray, seconds: float, source: str, blend: bool = False) -> dict:
    old = load_voiceprint() if blend else None
    if old:
        vec = _unit(np.asarray(old["embedding"]) * old["seconds"] + vec * seconds)
        seconds += old["seconds"]
    data = {
        "model": settings.voice_model,
        "embedding": [round(float(x), 6) for x in _unit(vec)],
        "seconds": round(seconds, 1),
        "source": source,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    delete_voiceprint()
    storage.write_bytes(_voiceprint_path(), json.dumps(data).encode())
    return data


def delete_voiceprint() -> None:
    for name in ("voiceprint.json.enc", "voiceprint.json"):
        (settings.data_path / name).unlink(missing_ok=True)


def voiceprint_from_audio(audio: np.ndarray, spans: list[tuple[float, float]] | None = None) -> tuple[np.ndarray, float]:
    """Average fingerprint over 3-second windows (or the given spans) that contain speech."""
    if spans is None:
        total = len(audio) / SAMPLE_RATE
        spans = [(float(s), min(float(s) + 3.0, total)) for s in np.arange(0, max(total - 1.0, 0.01), 1.5)]
    loud = []
    for s, e in spans:  # skip near-silent stretches
        piece = audio[int(s * SAMPLE_RATE) : int(e * SAMPLE_RATE)]
        if piece.size and float(np.sqrt(np.mean(piece**2))) > 0.01:
            loud.append((s, e))
    vecs = [v for v in embed(audio, loud, device="cpu") if v is not None]
    seconds = sum(e - s for s, e in loud)
    if len(vecs) < 3 or seconds < 8:
        raise ValueError("Not enough clear speech: please record at least 15 seconds of talking.")
    return _unit(np.mean(vecs, axis=0)), seconds


# ---------------------------------------------------------------------------
# The check itself
# ---------------------------------------------------------------------------


def check_speakers(audio: np.ndarray, segments: list[dict], diarized: bool, progress: Progress) -> tuple[list[dict], dict]:
    """Label every word with a speaker and a speaker confidence. Returns (segments, report)."""
    report: dict = {"used": False, "diarized": diarized, "corrected": 0}
    words = [(seg, w) for seg in segments for w in seg.get("words") or []]
    timed = [(seg, w) for seg, w in words if w.get("start") is not None and w.get("end") is not None]
    if len(timed) < 4:
        report["reason"] = "too little speech to compare voices"
        return segments, report

    vectors, centres_t = window_fingerprints(audio, resolve_device())
    progress(60)
    if len(vectors) < 4:
        report["reason"] = "too little speech to compare voices"
        return segments, report

    # Each word's fingerprint = mean of the windows that cover its middle (windows are in time order,
    # so each word's windows are a contiguous range; running sums make the means cheap).
    mids = np.array([(w["start"] + w["end"]) / 2 for _, w in timed])
    lo = np.searchsorted(centres_t, mids - WINDOW_SEC / 2, side="left")
    hi = np.searchsorted(centres_t, mids + WINDOW_SEC / 2, side="right")
    empty = hi <= lo
    nearest = np.clip(np.searchsorted(centres_t, mids), 0, len(centres_t) - 1)
    lo[empty], hi[empty] = nearest[empty], nearest[empty] + 1
    running = np.vstack([np.zeros((1, vectors.shape[1]), np.float32), np.cumsum(vectors, axis=0)])
    word_vecs = _unit_rows(running[hi] - running[lo])

    # The two voices: cluster windows that are mostly speech (edges of turns and pauses would
    # otherwise form a "voice" of their own).
    spans = np.array([(w["start"], w["end"]) for _, w in timed])
    coverage = np.zeros(len(vectors))
    for k, c in enumerate(centres_t):
        a, b = c - WINDOW_SEC / 2, c + WINDOW_SEC / 2
        inside = np.clip(np.minimum(spans[:, 1], b) - np.maximum(spans[:, 0], a), 0, None)
        coverage[k] = inside.sum() / WINDOW_SEC
    mostly_speech = coverage >= SPEECH_COVERAGE
    if mostly_speech.sum() < 8:
        mostly_speech = coverage > 0
    _, centres = two_voices(vectors[mostly_speech])
    centre_sim = float(centres[0] @ centres[1])
    report["voice_similarity"] = round(centre_sim, 3)
    if centre_sim > SAME_VOICE_SIM:
        report["reason"] = "the two voices sound too alike to tell apart"
        return segments, report
    report["used"] = True

    sims = word_vecs @ centres.T  # (n_words, 2)
    gaps = np.zeros(len(timed))
    gaps[1:] = [timed[i][1]["start"] - timed[i - 1][1]["end"] for i in range(1, len(timed))]
    voice = smooth(sims, gaps)
    margin = sims[np.arange(len(voice)), voice] - sims[np.arange(len(voice)), 1 - voice]
    progress(85)

    # Which voice is the counsellor (if a voiceprint was saved)?
    counsellor_voice = None
    voiceprint = load_voiceprint()
    if voiceprint:
        vp_sims = centres @ np.asarray(voiceprint["embedding"], dtype=np.float32)
        best = int(np.argmax(vp_sims))
        report["voiceprint_similarity"] = [round(float(s), 3) for s in vp_sims]
        if vp_sims[best] >= VOICEPRINT_MIN_SIM and vp_sims[best] - vp_sims[1 - best] >= VOICEPRINT_MIN_GAP:
            counsellor_voice = best

    labels_in = [w.get("speaker") or seg.get("speaker") for seg, w in timed] if diarized else []
    distinct = sorted({lab for lab in labels_in if lab})
    conf = np.array([_confidence(float(m)) for m in margin])

    if diarized and len(distinct) >= 2:
        # Match each voice to the pyannote label it overlaps most (by speaking time).
        a, b = distinct[0], distinct[1]
        dur = np.array([w["end"] - w["start"] for _, w in timed])
        straight = sum(d for d, v, lab in zip(dur, voice, labels_in) if (v, lab) in ((0, a), (1, b)))
        crossed = sum(d for d, v, lab in zip(dur, voice, labels_in) if (v, lab) in ((0, b), (1, a)))
        voice_label = {0: a, 1: b} if straight >= crossed else {0: b, 1: a}
        report["agreement"] = round(max(straight, crossed) / max(straight + crossed, 1e-9), 3)
        final = list(labels_in)
        if report["agreement"] < MIN_AGREEMENT:
            # Voices and pyannote disagree about most of the session: the voice grouping has more
            # likely gone wrong than pyannote, so keep pyannote's answer untouched.
            report.update(used=False, reason="voice analysis disagreed with speaker separation; kept the latter")
            for _, w in words:
                w.pop("spk_conf", None)
            return segments, report
        # Walk through runs of words where the voice disagrees with pyannote.
        i = 0
        while i < len(timed):
            if voice_label[int(voice[i])] == labels_in[i]:
                conf[i] = max(conf[i], 0.9)  # both layers agree
                i += 1
                continue
            j = i
            while j < len(timed) and voice_label[int(voice[j])] != labels_in[j]:
                j += 1
            run_sec = timed[j - 1][1]["end"] - timed[i][1]["start"]
            run_margin = float(np.mean(margin[i:j]))
            if run_sec >= MIN_CORRECT_SEC and run_margin >= CORRECT_MARGIN:
                for k in range(i, j):
                    final[k] = voice_label[int(voice[k])]
                report["corrected"] += 1
            elif run_sec >= 0.5:
                conf[i:j] = np.minimum(conf[i:j], 0.55)  # the layers disagree: ask the counsellor
            else:
                conf[i:j] = np.maximum(conf[i:j], 0.7)  # a word or two: not worth a flag
            i = j
    else:
        # The voices decide. Number them in order of appearance, like pyannote does.
        first = int(voice[0])
        voice_label = {first: "SPEAKER_00", 1 - first: "SPEAKER_01"}
        final = [voice_label[int(v)] for v in voice]

    if counsellor_voice is not None:
        report["counsellor_label"] = voice_label[counsellor_voice]

    # Smooth confidence over neighbouring words so one odd word does not flag a whole turn.
    smoothed = np.convolve(conf, np.ones(5) / 5, mode="same")
    edge = np.convolve(np.ones_like(conf), np.ones(5) / 5, mode="same")
    smoothed = smoothed / edge
    for (_, w), lab, c in zip(timed, final, smoothed):
        w["speaker"] = lab
        w["spk_conf"] = round(float(c), 3)
    # Words without timings follow the word before them.
    last = final[0]
    for _, w in words:
        if w.get("start") is None or w.get("end") is None:
            w["speaker"] = last
            w["spk_conf"] = None
        else:
            last = w["speaker"]
    for seg in segments:
        seg.pop("speaker", None)
    progress(100)
    return segments, report
