"""ffmpeg conversion to 16 kHz mono WAV (with background-noise reduction) and chunk joining."""

from __future__ import annotations

import io
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000

# Background noise handling, applied to uploads and live recordings alike.
# Kept deliberately gentle: Whisper copes with some noise, and aggressive denoising
# can swallow quiet speech, fillers and sighs, which matter in a verbatim transcript.
#   highpass/lowpass  remove rumble (traffic, AC, desk knocks) and hiss outside the speech band
#   afftdn            adaptive FFT denoiser that tracks steady noise (fans, hum, room tone)
#   dynaudnorm        evens out loudness so a soft-spoken client far from the mic is not lost
NOISE_FILTERS: dict[str, str] = {
    "off": "",
    "light": "highpass=f=80,lowpass=f=7800,afftdn=nr=10:nf=-50:tn=1,dynaudnorm=f=300:g=15:m=4:p=0.9",
    "strong": "highpass=f=100,lowpass=f=7000,afftdn=nr=22:nf=-38:tn=1,dynaudnorm=f=300:g=15:m=4:p=0.9",
}


class AudioError(RuntimeError):
    pass


def ffmpeg_path() -> str:
    """System ffmpeg if installed, otherwise the copy bundled with the imageio-ffmpeg package."""
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover - depends on the machine
        raise AudioError("ffmpeg was not found. Install it, or run: pip install imageio-ffmpeg") from exc


def convert_to_wav(src: Path, dst: Path, noise: str = "light") -> None:
    """Any audio/video file → 16 kHz mono 16-bit WAV, with optional noise reduction."""
    filters = NOISE_FILTERS.get(noise, NOISE_FILTERS["light"])
    cmd = [ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-vn", "-ac", "1",
           "-ar", str(SAMPLE_RATE)]
    if filters:
        # The denoiser learns the noise from the first moments; if speech starts at 0:00 it would
        # eat into the first word. A 1 s silent lead-in (trimmed off again) keeps timings unchanged.
        cmd += ["-af", f"adelay=1000:all=1,{filters},atrim=start=1,asetpts=PTS-STARTPTS"]
    cmd += ["-c:a", "pcm_s16le", str(dst)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not dst.exists() or dst.stat().st_size <= 44:
        detail = (result.stderr or "").strip().splitlines()[-1:] or ["no audio found"]
        raise AudioError(f"Could not read the audio in this file ({detail[0]}).")


def wav_to_array(data: bytes) -> np.ndarray:
    """16-bit mono WAV bytes → float32 array in [-1, 1], as WhisperX expects."""
    with wave.open(io.BytesIO(data)) as w:
        if w.getframerate() != SAMPLE_RATE or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise AudioError("Unexpected WAV format; expected 16 kHz mono 16-bit.")
        frames = w.readframes(w.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def wav_duration(data: bytes) -> float:
    with wave.open(io.BytesIO(data)) as w:
        return w.getnframes() / float(w.getframerate())


def encode_for_upload(src_wav: Path, dst: Path, start: float = 0.0, length: float | None = None) -> None:
    """Small Ogg/Opus copy (about 0.2 MB per minute) for cloud transcription size limits."""
    cmd = [ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-ss", str(start)]
    if length is not None:
        cmd += ["-t", str(length)]
    cmd += ["-i", str(src_wav), "-ac", "1", "-c:a", "libopus", "-b:a", "24k", str(dst)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise AudioError(f"Could not prepare audio for upload: {result.stderr.strip()[-200:]}")


def join_chunks(chunks: list[Path], writer, read) -> None:
    """Join MediaRecorder chunks in order.

    MediaRecorder writes the container header only in the first chunk, so the chunks are
    one continuous stream split into pieces: joining the bytes rebuilds the full recording.
    `read` turns a stored (possibly encrypted) chunk into bytes; `writer` has a write() method.
    """
    if not chunks:
        raise AudioError("No audio was received for this recording.")
    for chunk in chunks:
        writer.write(read(chunk))
