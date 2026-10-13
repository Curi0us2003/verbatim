# CLAUDE.md — Verbatim

Counselling session verbatim app. **SPEC.md is the source of truth**; re-read it before larger changes.

## Working agreement (from the user)
- 2026-10-14: the user asked for the WHOLE app in one run (all 7 phases), stopping only for things they must do
  themselves (tokens, installs needing permission, decisions the spec doesn't answer).
- Follow SPEC.md; if something is unclear or a bad idea, say so and propose an alternative instead of silently changing it.
- Free/open-source only. Every engine switchable via `.env`; local (WhisperX + Ollama) is the default.
- The user is not an expert programmer: explain simply, give exact commands and the expected output.
- Commit after each working step; keep this file updated.
- User asked to handle **background noise** in both recording and upload (see "Noise" below).

## Current status
- Phases 1–7 built. Backend: 31 pytest tests (fake engines) + 1 real-WhisperX test (`VERBATIM_REAL_MODELS=1`).
- Verified end-to-end in Edge via Playwright (scratch script, not in repo): setup password → upload → real WhisperX
  large-v3 on the GPU → review/playback/Space/search/edit/menu/dark mode; live recording with fake mic → 30 s
  chunks → transcript; settings/system check. Real-model pytest: word-perfect transcript of the sample.
- Not verifiable here: pyannote diarization (needs user's HF token), Ollama insights (Ollama not installed),
  Groq (no key). Those paths are covered by fake-engine tests only.

## User's machine
- Windows 11, NVIDIA RTX 3050 Laptop GPU (6 GB VRAM), Python 3.13 (WhisperX 3.8.6 supports 3.10–3.13).
- **C: drive is full (~1–2 GB free)** → heavy things live on D: via `.env`:
  `VENV_DIR=D:/Verbatim/venv`, `MODELS_DIR=D:/Verbatim/models`, `DATA_DIR=D:/Verbatim/data`.
  When running pip, set `TMP`/`TEMP` to a D: folder (setup.mjs does this).
- Project itself is inside OneDrive (code only; data is on D:). OneDrive occasionally locks files → retry edits.
- torch 2.8.0+cu128 + whisperx 3.8.6 + ctranslate2 4.8 work on the GPU (int8_float16 auto-selected for 6 GB).
- Ollama not installed yet; HF token not set yet.

## How to run
- `npm install` then `npm run setup` (once): .env (+ generated ENCRYPTION_KEY), venv (VENV_DIR), core + speech
  packages (CUDA torch if nvidia-smi found), frontend packages. `npm run setup -- --core` skips speech packages.
- `npm run dev`: FastAPI on 127.0.0.1:8000 + Vite on 127.0.0.1:5173 (proxies `/api`). No auto-reload on purpose
  (OneDrive touches files → reload mid-transcription). `npm run dev:watch` = with backend auto-reload for development.
- After speech models load, lifespan shutdown calls os._exit (CUDA libs hang Python exit on Windows).
- `npm test`: backend pytest. `npx tsc -b` in frontend: type-check.
- Stopping background dev runs from Claude: TaskStop leaves orphan uvicorn/vite processes — kill the whole tree
  (match `concurrently.js|uvicorn app.main:app|vite.js|multiprocessing.spawn`). For UI tests use
  `DATA_DIR=D:/Verbatim/test-data` so the user's real password/data are untouched (test password: e2e-password-1).

## Architecture
- `backend/app/main.py` all routes (`/api`), login middleware (signed cookie; public: health, auth/status|login|setup).
- `models.py` 4 SQLModel tables + read/request models; `_migrate()` adds new Session columns to old DBs.
- `jobs.py` single worker thread (one job at a time): `process` = convert → transcribe → diarize → turns/roles/exchanges;
  `insights`; hourly retention; marks interrupted jobs failed on startup.
- `storage.py` audio files, Fernet encryption in 1 MiB blocks (streamed writes + range reads for playback).
- `pipeline/`: `audio.py` (ffmpeg or imageio-ffmpeg; noise filters), `transcribe.py` (WhisperX/Groq, hallucination
  filter, device/compute auto), `diarize.py` (pyannote via whisperx, num_speakers=2), `turns.py` (merge, pauses,
  exchanges, regroup keeping insights), `roles.py` (question heuristic, LLM fallback, no-diarization guess).
- `ai/`: `llm.py` (Ollama/Groq, JSON extract, 1 retry), `prompts.py` (SPEC prompts verbatim), `insights.py`.
- `prefs.py` settings.json in DATA_DIR (password hash, cookie secret, retention days, auto insights, default noise).
- `export.py` TXT / DOCX (python-docx) / PDF = print-ready HTML that opens the browser print dialog.
- Frontend: React 18 + Vite 6 + TS + Tailwind v4 + hand-written shadcn/ui (`src/components/ui`). `api.ts` = all calls;
  `AuthGate` = lock screen; `SessionReview` = processing/failed/review states, polling, shortcuts.

## Noise handling
- Recording: getUserMedia noiseSuppression/echoCancellation/autoGainControl (toggle), mic test measures room noise
  floor and suggests "strong".
- Every file: ffmpeg filter per session (`off|light|strong`: highpass/lowpass, afftdn, dynaudnorm m=4) with a 1 s
  silent lead-in (trimmed after) so afftdn doesn't eat a first word at 0:00; default in
  Settings/.env `NOISE_REDUCTION`. Test `test_noise_reduction_improves_speech_to_noise` checks SNR gain.
- Transcription: VAD, condition_on_previous_text=False, hallucination phrase filter; Re-process with another level.

## Deliberate deviations / additions to the spec (tell the user)
- Extra Session fields: consent_at, warning, noise_reduction, detected_language, audio_deleted_at, original_path.
- Extra routes: /health, /health/llm, /auth/*, /settings, /sessions/{id}/reprocess, /sessions/{id}/redact,
  /turns/{id}/split. Extra files: jobs.py, storage.py, security.py, prefs.py.
- Python 3.13 instead of 3.11 (WhisperX 3.8 supports it). whisperx 3.8 uses pyannote.audio 4; DIARIZATION_MODEL
  defaults to the spec's speaker-diarization-3.1 (community-1 is an option).
- PDF export via browser print (renders Hindi/Kannada; WeasyPrint needs GTK on Windows).
- Buttons use sage #4A7666 (spec #5B8C7A fails the spec's own 4.5:1 contrast with white text).
- Without HF token: transcript still produced, speakers guessed from questions, warning banner shown.
- Kannada has no default word-alignment model → evenly spread word times, no confidence underline (ALIGN_MODEL_KN option).
