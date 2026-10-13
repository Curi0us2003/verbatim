# Verbatim

A private app for counsellors. It records or accepts a session recording, makes a word-for-word
transcript, shows counsellor and client speech side by side, and offers an AI reading of what the
client seems to mean. Everything runs on your own computer by default.

The full design is in [SPEC.md](SPEC.md). The current build status is in [CLAUDE.md](CLAUDE.md).

## What you need installed

| Tool | Needed from | Get it |
| --- | --- | --- |
| Node.js 20 or newer | Phase 1 | https://nodejs.org |
| Python 3.11 (3.12/3.13 work for Phase 1 only) | Phase 1 | https://www.python.org/downloads/release/python-3119/ |
| ffmpeg | Phase 2 | `winget install Gyan.FFmpeg` (Windows) |
| Hugging Face token | Phase 3 | see SPEC.md → Build plan → One-time setup |
| Ollama + `ollama pull qwen2.5:7b` | Phase 6 | https://ollama.com |

## First-time setup

Open a terminal in this folder and run:

```
npm install
npm run setup
```

`npm run setup` creates a Python environment in `backend/.venv`, installs the backend and
frontend packages, and copies `.env.example` to `.env`. It takes a few minutes the first time.

## Run the app

```
npm run dev
```

This starts both servers:

- the backend (FastAPI) on http://127.0.0.1:8000
- the frontend (the app) on **http://127.0.0.1:5173**, so open this one in your browser

For the first few seconds you may see `http proxy error ... ECONNREFUSED` lines. That only
means the backend is still starting up. Press `Ctrl+C` to stop both servers.

## Run the tests

```
npm test
```

## Settings

All settings live in `.env` (see `.env.example` for an explanation of each one). The important
ones are:

- `TRANSCRIBE_ENGINE=local|groq` and `LLM_ENGINE=ollama|groq`. Local is the private default.
- `WHISPER_MODEL`, `OLLAMA_MODEL`: which models to use.
- `DATA_DIR`: where audio and the database are stored. **Keep it outside OneDrive or any other
  cloud-synced folder**, or session recordings will be uploaded to that cloud.

## Folder layout

```
backend/app/       FastAPI app: main.py (routes), models.py (database tables), config.py (.env)
backend/app/pipeline/  audio conversion, transcription, speakers, turns, roles
backend/app/ai/        LLM client, prompts, insights
frontend/src/      React app: pages/, components/, api.ts
scripts/           helpers behind npm run setup / dev / test
data/              audio + SQLite database (git-ignored, private)
```
