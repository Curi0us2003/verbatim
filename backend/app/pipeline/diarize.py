"""Speaker separation with pyannote (via WhisperX), always run locally with num_speakers=2."""

from __future__ import annotations

import logging

import numpy as np

from ..config import settings
from .transcribe import Progress, free_memory, model_dir, prepare_torch, resolve_device

log = logging.getLogger("verbatim.diarize")


class DiarizationUnavailable(RuntimeError):
    """Speaker separation could not run; the transcript is still usable."""


def diarize(audio: np.ndarray, segments: list[dict], progress: Progress) -> list[dict]:
    """Label every segment and word with SPEAKER_00 / SPEAKER_01."""
    if not settings.hf_token:
        raise DiarizationUnavailable(
            "Speaker separation was skipped: add your free Hugging Face token as HF_TOKEN in .env "
            "(see README), then use Re-process."
        )
    prepare_torch()
    try:
        import whisperx
        from whisperx.diarize import DiarizationPipeline
    except ImportError as exc:
        raise DiarizationUnavailable("Speaker separation was skipped: WhisperX/pyannote is not installed.") from exc

    device = resolve_device()
    progress(2)
    try:
        pipeline = DiarizationPipeline(
            model_name=settings.diarization_model,
            token=settings.hf_token,
            device=device,
            cache_dir=model_dir("pyannote"),
        )
    except Exception as exc:
        log.exception("Could not load diarization model")
        raise DiarizationUnavailable(
            f"Speaker separation was skipped: could not load {settings.diarization_model}. "
            "Check HF_TOKEN and that you accepted the model terms on Hugging Face "
            f"(pyannote/speaker-diarization-3.1 and pyannote/segmentation-3.0). Details: {exc}"
        ) from exc
    progress(10)
    diarized = pipeline(audio, num_speakers=2, progress_callback=lambda p: progress(10 + p * 0.85))
    result = whisperx.assign_word_speakers(diarized, {"segments": segments}, fill_nearest=True)
    del pipeline
    free_memory()
    progress(100)
    return result["segments"]
