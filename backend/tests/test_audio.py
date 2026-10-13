"""ffmpeg conversion and background-noise reduction on a real (synthetic-voice) recording."""

import subprocess
import wave

import numpy as np
import pytest
from conftest import SAMPLE

from app.pipeline import audio


def _read(path) -> np.ndarray:
    with wave.open(str(path)) as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x**2)) + 1e-9)


@pytest.mark.parametrize("level", ["off", "light", "strong"])
def test_convert_to_16k_mono(tmp_path, level):
    out = tmp_path / "out.wav"
    audio.convert_to_wav(SAMPLE, out, level)
    data = _read(out)
    assert 20 < len(data) / 16000 < 40


@pytest.fixture
def noisy_sample(tmp_path):
    """The sample dialogue with steady background noise (like a fan or traffic) mixed in."""
    out = tmp_path / "noisy.wav"
    cmd = [
        audio.ffmpeg_path(), "-loglevel", "error", "-y", "-i", str(SAMPLE),
        "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.06:sample_rate=16000",
        "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first:normalize=0", "-ac", "1", str(out),
    ]
    subprocess.run(cmd, check=True)
    return out


def _windows(data: np.ndarray, size: int = 8000) -> np.ndarray:
    n = len(data) // size
    return np.array([_rms(data[i * size : (i + 1) * size]) for i in range(n)])


def test_noise_reduction_improves_speech_to_noise(tmp_path, noisy_sample):
    # Where speech and pauses are, taken from the noise-free original.
    clean = tmp_path / "clean.wav"
    audio.convert_to_wav(SAMPLE, clean, "off")
    ref = _windows(_read(clean))
    speech = ref > np.percentile(ref, 60)
    quiet = ref <= np.percentile(ref, 15)

    def snr(level: str) -> float:
        out = tmp_path / f"{level}.wav"
        audio.convert_to_wav(noisy_sample, out, level)
        w = _windows(_read(out))
        n = min(len(w), len(ref))
        return w[:n][speech[:n]].mean() / w[:n][quiet[:n]].mean()

    off, light, strong = snr("off"), snr("light"), snr("strong")
    assert light > off * 1.1, (off, light)
    assert strong > off * 1.3, (off, strong)


def test_unreadable_file_gives_friendly_error(tmp_path):
    bad = tmp_path / "bad.mp3"
    bad.write_bytes(b"this is not audio")
    with pytest.raises(audio.AudioError):
        audio.convert_to_wav(bad, tmp_path / "x.wav")
