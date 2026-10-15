# Verbatim

A private app for counsellors. It records a session in the browser or accepts a recording, makes a
word-for-word transcript, shows counsellor and client speech side by side in colour, and offers an
AI reading of what the client seems to mean in each exchange. Everything runs on your own computer
by default.

The full design is in [SPEC.md](SPEC.md). Build status and notes for developers are in [CLAUDE.md](CLAUDE.md).

## 1. Install the tools (once)

| Tool | What for | How |
| --- | --- | --- |
| Node.js 20+ | runs the app | https://nodejs.org |
| Python 3.10–3.13 | speech models and server | https://www.python.org/downloads/ (tick "Add to PATH") |
| Ollama | local AI insights | https://ollama.com → install, then run `ollama pull qwen2.5:7b` (see note below) |
| ffmpeg | audio conversion | optional: a copy is installed automatically; or `winget install Gyan.FFmpeg` |

**Ollama on another drive:** before installing, set the Windows user variable `OLLAMA_MODELS` to a folder on a
drive with space (e.g. `D:\Verbatim\ollama-models`), and install with
`OllamaSetup.exe /DIR="D:\Verbatim\ollama"`. On this computer that is already done.

You need about **10 GB of free disk space**: about 4 GB for the speech software, about 4 GB for the speech
models, and about 5 GB for the Ollama model. If your system drive is full, use another drive (see step 2).

## 2. Configure

Copy `.env.example` to `.env`, or let `npm run setup` do it, then open `.env` in a text editor:

- `DATA_DIR`: where recordings and the database are stored. **Keep it outside OneDrive, Dropbox or Google Drive**,
  otherwise session audio is uploaded to that cloud. Example: `DATA_DIR=D:/Verbatim/data`
- `VENV_DIR` and `MODELS_DIR`: put the large Python environment and the models on a drive with free space.
  Example: `VENV_DIR=D:/Verbatim/venv` and `MODELS_DIR=D:/Verbatim/models`
- `ENCRYPTION_KEY`: created for you by setup. **Save a copy somewhere safe.** Without it, encrypted
  recordings cannot be played.

## 3. Set up (once, 10–30 minutes)

```
npm install
npm run setup
```

This creates the Python environment, installs the speech models' software (with GPU support if you have an
NVIDIA card) and the app's packages. When it works, the last line says `Setup finished`.

## 4. Speaker separation: free Hugging Face token (once)

Without this step you still get a transcript, but every line has to be marked "Counsellor" or "Client" by you.

1. Create a free account at https://huggingface.co.
2. Open https://huggingface.co/pyannote/speaker-diarization-3.1 and https://huggingface.co/pyannote/segmentation-3.0,
   and click **Agree and access repository** on each page.
3. Go to https://huggingface.co/settings/tokens → **Create new token** → type **Read** → copy it.
4. Paste it into `.env`: `HF_TOKEN=hf_...`, then restart the app.

## 5. Run

```
npm run dev
```

Open **http://127.0.0.1:5173**. The first time, you choose an app password. In the first few seconds you may see
`ECONNREFUSED` lines while the backend starts; that is normal. Press `Ctrl+C` to stop.

The first transcription downloads the Whisper model (about 3 GB), so it takes longer. After that, a 50-minute
session takes a few minutes on a GPU.

**Settings → System check** shows what is ready and what still needs setting up.

## Who said what: two layers

1. **Speaker separation (pyannote)** splits the recording into two speakers. It needs the free Hugging
   Face token (step 4).
2. **Voice analysis** compares short "voice fingerprints" (about every half second) and groups them into the
   two voices. It needs no token and runs on this computer.
   - With the token, it double-checks pyannote: clear mistakes are corrected, and unclear turns get a
     **Check speaker** flag. The *Next to check* button on the review page jumps between them.
   - Without the token, voice analysis separates the speakers on its own.
3. **Your voiceprint (optional, recommended):** in **Settings → Your voice**, read a short passage for 20 seconds.
   From then on the counsellor is recognised by voice in every session, even when the client speaks first.
   Only a fingerprint (a list of numbers) is stored, encrypted. The recording is deleted straight away. You
   can also use **⋯ → Learn my voice from this session** on a session whose roles are correct.

In tests with real recorded voices (same-gender pairs, with and without background noise), guessing from
questions put 54–90% of speech with the right person. Voice analysis got 99–100%, and the voiceprint picked out
the counsellor 10 times out of 10. Very similar voices, people talking over each other and very short replies
("Mm.") are still hard, so always glance over turns flagged **Check speaker**.

To re-check older sessions with voice analysis, open them and use **⋯ → Re-process audio…**. This replaces the
transcript, including your edits.

## Background noise

- **While recording**, the browser's noise suppression and echo cancellation are on by default. *Test microphone*
  measures the room and suggests strong noise reduction if it is noisy.
- **For every recording and upload**, a background-noise filter runs before transcription: *Off*, *Light*
  (the default) or *Strong* (fans, AC, traffic). Choose it per session, or set the default in Settings.
- Voice-activity detection skips stretches that are only noise, and a filter removes phrases Whisper is known to
  invent from noise (for example "Thank you for watching").
- If a transcript came out poorly, use **⋯ → Re-process audio…** to run it again with stronger noise reduction.

## Languages

Choose English, Hindi or Kannada per session, or *Auto-detect*. Auto-detect listens at three points in the
recording and only chooses between the languages in `AUTO_LANGUAGES` (default `en,hi,kn`), because Whisper on
its own often mistakes spoken Hindi for Urdu and writes Urdu script.

- **English and Hindi:** word-level timings and "unclear word" underlines.
- **Kannada:** the transcript works, but no reliable free word-alignment model exists, so word times are spread
  evenly across each sentence and unclear words are not underlined.
- **Mixed speech (Hinglish and similar):** the whole session is transcribed in one language. Pick the main one.

## Cloud mode (optional, not private)

Set `TRANSCRIBE_ENGINE=groq` and/or `LLM_ENGINE=groq` and add a free `GROQ_API_KEY` from https://console.groq.com.
A yellow banner then shows on every screen, because audio or text is sent to a third-party service.
Speaker separation always runs locally.

## Forgot the app password?

Stop the app, open `DATA_DIR/settings.json`, delete the `"password_hash"` line, and start the app again. You
will be asked to choose a new password. Your sessions are not affected.

## Tests

```
npm test
```

Runs the backend tests with fake speech engines, which takes seconds. To test real WhisperX transcription of the
included sample dialogue as well (slow):

```
set VERBATIM_REAL_MODELS=1
npm test -- tests/test_real_models.py -s
```

## Folder layout

```
backend/app/            FastAPI app: main.py (routes), models.py (tables), jobs.py (background worker)
backend/app/pipeline/   audio (ffmpeg + noise), transcribe, diarize, turns, roles
backend/app/ai/         llm (Ollama/Groq), prompts, insights
backend/tests/          pytest tests + a synthetic sample dialogue
frontend/src/           React app: pages/, components/, api.ts
scripts/                helpers behind npm run setup / dev / test
```
