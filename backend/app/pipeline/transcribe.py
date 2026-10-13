"""Transcription engines: WhisperX (local, default) and Groq (optional cloud).

Both return the same shape:
    segments = [{"start", "end", "text", "words": [{"word", "start", "end", "score"}]}]
plus the language code that was used or detected.
"""

from __future__ import annotations

import gc
import logging
import math
import os
import re
import sys
import tempfile
import time
from collections.abc import Callable
from pathlib import Path

import numpy as np

from ..config import settings
from . import audio as audio_mod

log = logging.getLogger("verbatim.transcribe")

Progress = Callable[[float], None]  # 0–100 within the current stage

# F1: a disfluent prompt nudges Whisper to keep fillers instead of cleaning speech up.
INITIAL_PROMPT = "Umm, so, I mean... yeah. Hmm."

# Phrases Whisper is known to invent during silence or background noise.
HALLUCINATIONS = {
    "thank you for watching",
    "thanks for watching",
    "thank you for watching and see you next time",
    "please subscribe",
    "like and subscribe",
    "subtitles by the amaraorg community",
    "transcribed by",
    "transcription by castingwords",
    "you",
    "thank you",
    "bye",
}

GROQ_LANGUAGES = {"english": "en", "hindi": "hi", "kannada": "kn"}


class TranscriptionError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Device helpers (shared with diarize.py)
# ---------------------------------------------------------------------------


def prepare_torch() -> None:
    """On Windows, let faster-whisper find the CUDA/cuDNN DLLs that ship inside PyTorch."""
    if sys.platform != "win32":
        return
    try:
        import torch

        lib = Path(torch.__file__).parent / "lib"
        if lib.exists():
            os.add_dll_directory(str(lib))
            os.environ["PATH"] = str(lib) + os.pathsep + os.environ.get("PATH", "")
    except ImportError:
        pass


def resolve_device() -> str:
    if settings.whisper_device != "auto":
        return settings.whisper_device
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except ImportError:
        return "cpu"


def resolve_compute_type(device: str) -> str:
    if settings.whisper_compute_type != "auto":
        return settings.whisper_compute_type
    if device == "cuda":
        import torch

        vram_gb = torch.cuda.get_device_properties(0).total_memory / 2**30
        # 6 GB cards: int8 weights with float16 maths leaves room for alignment + diarization.
        return "float16" if vram_gb >= 10 else "int8_float16"
    return "int8"


def free_memory() -> None:
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass


def model_dir(sub: str) -> str | None:
    return str(settings.models_path / sub) if settings.models_path else None


# ---------------------------------------------------------------------------
# Shared clean-up
# ---------------------------------------------------------------------------


def _normalise(text: str) -> str:
    return re.sub(r"[^a-z ]", "", text.lower()).strip()


def clean_segments(segments: list[dict]) -> list[dict]:
    """Drop empty segments and phrases Whisper invents from noise; fill in missing word lists."""
    out = []
    for seg in segments:
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        words = [w for w in seg.get("words") or [] if (w.get("word") or "").strip()]
        scores = [w["score"] for w in words if w.get("score") is not None]
        avg = sum(scores) / len(scores) if scores else None
        if _normalise(text) in HALLUCINATIONS and (avg is None or avg < 0.5):
            continue
        if not words:
            words = estimate_words(text, seg["start"], seg["end"])
        out.append({
            "start": float(seg["start"]),
            "end": float(seg["end"]),
            "text": text,
            "words": [
                {
                    "word": w["word"].strip(),
                    "start": _num(w.get("start")),
                    "end": _num(w.get("end")),
                    "score": _num(w.get("score")),
                }
                for w in words
            ],
            **({"speaker": seg["speaker"]} if seg.get("speaker") else {}),
        })
    return out


def _num(value) -> float | None:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else round(f, 3)


def estimate_words(text: str, start: float, end: float, score: float | None = None) -> list[dict]:
    """Spread words evenly over a segment when no word-level timings exist (e.g. Kannada)."""
    tokens = text.split()
    step = (end - start) / max(len(tokens), 1)
    return [
        {"word": t, "start": start + i * step, "end": start + (i + 1) * step, "score": score}
        for i, t in enumerate(tokens)
    ]


# ---------------------------------------------------------------------------
# Local: WhisperX
# ---------------------------------------------------------------------------


def transcribe_local(audio: np.ndarray, language: str | None, progress: Progress) -> tuple[list[dict], str]:
    prepare_torch()
    try:
        import whisperx
    except ImportError as exc:
        raise TranscriptionError(
            "WhisperX is not installed. Run `npm run setup`, or set TRANSCRIBE_ENGINE=groq in .env."
        ) from exc

    device = resolve_device()
    compute_type = resolve_compute_type(device)
    log.info("WhisperX %s on %s (%s)", settings.whisper_model, device, compute_type)
    progress(2)
    model = whisperx.load_model(
        settings.whisper_model,
        device,
        compute_type=compute_type,
        language=language,
        asr_options={
            "initial_prompt": INITIAL_PROMPT,
            "condition_on_previous_text": False,  # avoids repetition loops in noisy audio
            "no_speech_threshold": 0.6,
        },
        vad_method=settings.vad_method,
        download_root=model_dir("whisper"),
        threads=max(1, (os.cpu_count() or 4) // 2),
    )
    progress(10)

    batch = max(1, settings.whisper_batch_size)
    while True:
        try:
            result = model.transcribe(
                audio,
                batch_size=batch,
                language=language,
                progress_callback=lambda p: progress(10 + p * 0.65),
            )
            break
        except RuntimeError as exc:  # CUDA out of memory: retry with smaller batches
            if "out of memory" not in str(exc).lower() or batch == 1:
                raise
            batch = max(1, batch // 2)
            log.warning("Out of GPU memory; retrying with batch size %d", batch)
            free_memory()
    detected = result.get("language") or language or "en"
    del model
    free_memory()
    progress(78)

    segments = result["segments"]
    try:
        align_name = settings.align_model_kn if detected == "kn" and settings.align_model_kn else None
        align_model, metadata = whisperx.load_align_model(
            language_code=detected, device=device, model_name=align_name, model_dir=model_dir("align")
        )
        aligned = whisperx.align(
            segments, align_model, metadata, audio, device, return_char_alignments=False,
            progress_callback=lambda p: progress(78 + p * 0.2),
        )
        segments = aligned["segments"]
        del align_model
    except Exception as exc:  # no alignment model for this language, or download failed
        log.warning("Word alignment unavailable for %s: %s", detected, exc)
    free_memory()
    progress(100)
    return clean_segments(segments), detected


# ---------------------------------------------------------------------------
# Cloud: Groq
# ---------------------------------------------------------------------------

GROQ_CHUNK_SEC = 600  # 10-minute pieces stay far below the ~25 MB upload limit


def transcribe_groq(wav: Path, duration: float, language: str | None, progress: Progress) -> tuple[list[dict], str]:
    import httpx

    if not settings.groq_api_key:
        raise TranscriptionError("TRANSCRIBE_ENGINE=groq needs GROQ_API_KEY in .env.")
    segments: list[dict] = []
    detected = language
    pieces = max(1, math.ceil(duration / GROQ_CHUNK_SEC))
    with tempfile.TemporaryDirectory() as tmp, httpx.Client(timeout=300) as client:
        for i in range(pieces):
            offset = i * GROQ_CHUNK_SEC
            piece = Path(tmp) / f"piece{i}.ogg"
            audio_mod.encode_for_upload(wav, piece, start=offset, length=GROQ_CHUNK_SEC)
            data = {
                "model": settings.groq_whisper_model,
                "response_format": "verbose_json",
                "timestamp_granularities[]": ["word", "segment"],
                "temperature": "0",
                "prompt": INITIAL_PROMPT,
            }
            if language:
                data["language"] = language
            body = _groq_post(client, piece, data)
            detected = detected or GROQ_LANGUAGES.get(str(body.get("language", "")).lower(), body.get("language"))
            segments += _groq_segments(body, offset)
            progress((i + 1) / pieces * 100)
    return clean_segments(segments), detected or "en"


def _groq_post(client, piece: Path, data: dict) -> dict:
    for attempt in range(6):
        with open(piece, "rb") as f:
            resp = client.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                data=data,
                files={"file": (piece.name, f, "audio/ogg")},
            )
        if resp.status_code == 429 and attempt < 5:  # free-tier rate limit: wait and retry
            time.sleep(float(resp.headers.get("retry-after", 20)))
            continue
        if resp.status_code >= 400:
            raise TranscriptionError(f"Groq transcription failed ({resp.status_code}): {resp.text[:300]}")
        return resp.json()
    raise TranscriptionError("Groq rate limit: try again in a few minutes.")


def _groq_segments(body: dict, offset: float) -> list[dict]:
    words = body.get("words") or []
    out = []
    for seg in body.get("segments") or []:
        start, end = seg["start"], seg["end"]
        # Groq gives no per-word confidence; use the segment's average log-probability instead.
        score = round(min(1.0, math.exp(seg.get("avg_logprob", 0.0))), 3)
        seg_words = [
            {"word": w["word"], "start": w["start"] + offset, "end": w["end"] + offset, "score": score}
            for w in words
            if start <= (w["start"] + w["end"]) / 2 < end
        ]
        out.append({
            "start": start + offset,
            "end": end + offset,
            "text": seg.get("text", ""),
            "words": seg_words or estimate_words(seg.get("text", ""), start + offset, end + offset, score),
        })
    return out


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def transcribe(audio: np.ndarray, wav: Path, language: str | None, progress: Progress) -> tuple[list[dict], str]:
    lang = None if not language or language == "auto" else language
    if settings.transcribe_engine == "groq":
        return transcribe_groq(wav, len(audio) / audio_mod.SAMPLE_RATE, lang, progress)
    return transcribe_local(audio, lang, progress)
