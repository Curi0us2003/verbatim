# CLAUDE.md — Verbatim

Counselling session verbatim app. **SPEC.md is the source of truth**; re-read it before each phase.

## Working agreement (from the user)
- Build one phase at a time (SPEC.md → "Build plan"). Never start the next phase until the user confirms the current one works.
- Before coding a phase: give a short plan (files to create/change + anything the user must install/set up).
- Follow SPEC.md exactly; if something is unclear or a bad idea, say so and propose an alternative instead of silently changing it.
- Free/open-source only. Every engine switchable via `.env`; local (WhisperX + Ollama) is the default.
- The user is not an expert programmer: explain simply, give exact commands and the expected output.
- End of each phase: a short test checklist, a git commit, and an update to this file.

## Current status
- User changed plan (2026-10-14): build ALL remaining phases in one run, no stopping between phases.
- Phase 1 — Skeleton: done.
- Backend for Phases 2–7: done and tested with fake engines (30 pytest tests). Frontend for Phases 2–7: in progress.

## User's machine
- Windows 11, NVIDIA RTX 3050 Laptop GPU (6 GB VRAM).
- Python 3.13 installed; **3.11 not yet installed** (needed for WhisperX in Phase 2; then delete `backend/.venv` and re-run `npm run setup`).
- ffmpeg and Ollama not yet installed.
- Project lives inside OneDrive. `DATA_DIR` in `.env` should point outside OneDrive for real sessions.

## How to run
- `npm install` then `npm run setup` (once): creates `backend/.venv`, installs packages, copies `.env`.
- `npm run dev`: FastAPI on 127.0.0.1:8000 and Vite on 127.0.0.1:5173 (Vite proxies `/api`).
- `npm test`: backend pytest. `npm run build --prefix frontend`: type-check + build.

## Layout and conventions
- Backend: `backend/app/main.py` (routes, prefix `/api`), `models.py` (SQLModel tables + engine + read models), `config.py` (pydantic-settings, reads root `.env`).
  `pipeline/`, `ai/` and `export.py` are stubs whose docstrings name the phase that fills them.
- Deviations/additions to the spec, all deliberate:
  - `Session.consent_at` field added (the privacy section requires storing consent time).
  - `GET /api/health` added (backend check + engine/cloud mode for the Phase 7 banner).
  - `DATA_DIR` setting added so data can live outside cloud-synced folders.
  - Filled buttons use sage `#4A7666` (white text 5.1:1); spec's `#5B8C7A` gives only 3.8:1, below the spec's own 4.5:1 rule. `#5B8C7A` is kept for accents/rings (`--sage`).
- Frontend: React 18 + Vite 6 + TS + Tailwind v4 (`@tailwindcss/vite`, tokens in `src/index.css`) + shadcn/ui components hand-written in `src/components/ui/` (shadcn's Toast = `sonner`). Path alias `@/` → `src/`.
  Types in `src/types.ts` mirror `models.py`. All backend calls go through `src/api.ts`.
- Review page `/sessions/demo` uses `src/lib/placeholder.ts` (fictional data) and a fake playback clock (`useDemoClock`) until Phase 4 adds real audio.
- Dark-mode tokens already exist under `.dark` in `index.css`; the toggle comes in Phase 7.
