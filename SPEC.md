# Counselling Verbatim App — Build Spec for Claude Code

Oct 13, 2026 · @Rito

## Overview

The app, working name **Verbatim**, records or accepts a counselling session audio file, transcribes it, separates counsellor and client speech, and gives the counsellor an AI reading of what the client seems to mean after each question and answer. It runs entirely on free, open-source tools, with an option to swap in free cloud tiers for speed.

**Who uses it:** one counsellor, on their own laptop or a small server, reviewing sessions after they end. The client never logs in.

**How to use this spec with Claude Code:**

1. Create an empty project folder and save this doc into it as `SPEC.md` (export the doc as Markdown).
2. Open Claude Code in that folder and say: "Read SPEC.md. We will build this app phase by phase. Start with Phase 1 only."
3. Paste the phase prompts from the Build plan section one at a time. Test each phase before moving on.
4. Keep this file in the repo so Claude Code can re-read it whenever it loses context.

**Six required features (from the brief):**

1. A verbatim (word-for-word) transcript of every session.
2. Live recording of a session in the browser, then transcription.
3. A review screen where counsellor and client speech are shown in quotes and in different colours.
4. An AI interpretation of what the client means, for each question and answer pair.
5. Upload of an existing recording that goes through the same pipeline.
6. A clean, calm, easy-to-use interface.

## Free tech stack

The best free combination is **WhisperX** (Whisper large-v3 + word alignment + pyannote speaker diarization) for transcripts and **Ollama** running a local open model for interpretation. Both run on your own machine, so session audio never leaves it. A free cloud mode (Groq) is offered as a switch for speed on slow laptops.

| Job | Default (local, private, free) | Optional free cloud mode | Notes |
| --- | --- | --- | --- |
| Frontend | React + Vite + TypeScript + Tailwind CSS + shadcn/ui | — | Fast to build, polished components |
| Backend | Python 3.11 + FastAPI | — | Python is needed for the speech models |
| Recording | Browser MediaRecorder API (webm/opus) | — | Built into Chrome, Edge, Firefox |
| Audio conversion | ffmpeg (to 16 kHz mono WAV) | — | Must be installed on the machine |
| Transcription | WhisperX with faster-whisper `large-v3` | Groq `whisper-large-v3` API | Groq free tier is rate-limited, caps uploads at about 25 MB, and has no privacy guarantee ([source](https://costbench.com/software/llm-api-providers/groq/)) |
| Speaker separation (diarization) | pyannote `speaker-diarization-3.1` via WhisperX, `num_speakers=2` | — (always local) | Needs a free Hugging Face token and accepting the model terms |
| AI interpretation | Ollama with `qwen2.5:7b` or `llama3.1:8b` | Groq free tier (Llama 3.3 70B class) | Larger cloud models write better interpretations but send text off-device |
| Database | SQLite via SQLModel | — | One file, no server |
| PDF / Word export | WeasyPrint or browser print; python-docx | — | For case notes |

**Accuracy vs hardware:**

- **With an NVIDIA GPU (6 GB+ VRAM):** use `large-v3` locally. A 50-minute session transcribes and diarizes in a few minutes. This is the most accurate free setup.
- **CPU only (typical laptop):** use `large-v3-turbo` or `medium` with `int8` compute. Expect processing to take roughly as long as the session or longer. Or switch transcription to Groq mode and keep diarization local.
- **Languages:** Whisper handles English, Hindi and Kannada, including mixed speech, but accuracy drops for code-mixed Kannada/Hindi-English. Let the counsellor pick the language per session, with "auto-detect" as default.

**Make every engine switchable** through a `.env` file (`TRANSCRIBE_ENGINE=local|groq`, `LLM_ENGINE=ollama|groq`, `WHISPER_MODEL`, `OLLAMA_MODEL`), so you can change services later without code changes. Free-tier limits change often; check the provider's current limits page before relying on them.

## Architecture and pipeline

A React frontend talks to a FastAPI backend on the same machine; the backend runs one background job per session through the stages below and saves results to SQLite.

[embedded content: processing pipeline · 9 stages]

Recording and upload join the same pipeline at the conversion step, so both features share all the processing code. The frontend polls `/status` to show which stage is running, and the counsellor can open the review screen as soon as speakers are separated; AI insights fill in afterwards.

## Feature specifications

### F1. Verbatim transcript

- Transcribe word for word. Keep fillers ("um", "uh"), repetitions and false starts, because counsellors use them clinically. Pass a Whisper `initial_prompt` like "Umm, so, I mean... yeah. Hmm." to stop it cleaning speech up.
- Mark pauses longer than 2 seconds inline as `[pause 4s]`, computed from word timestamps.
- Mark unclear words (low word confidence, below 0.4) with a dotted underline so the counsellor can check them.
- Every segment stores start and end timestamps.

### F2. Live recording

- Big round Record button, with Pause, Resume and Stop. Show a running timer and a live audio level meter so the counsellor knows the mic works.
- Before recording, a required checkbox: "The client has given informed consent to record this session."
- Fields: session title, client code (a pseudonym such as C-014, never a real name), language (auto / English / Hindi / Kannada), date.
- Save audio in 30-second chunks to the backend while recording, so a browser crash loses at most 30 seconds. On Stop, the backend joins the chunks and starts processing.
- Warn before closing the tab while recording.

### F3. Review screen with speaker separation

- Show the transcript as a conversation: counsellor turns aligned left in a blue tone, client turns aligned right in a warm amber tone. Each turn is wrapped in quotation marks and labelled "Counsellor" or "Client" with its timestamp.
- Merge consecutive segments from the same speaker into one turn.
- Automatic role detection: diarization gives `SPEAKER_00` and `SPEAKER_01`; the app then decides which one is the counsellor (see AI prompts). Show a one-click **Swap roles** button in case it guesses wrong.
- Per turn: click the timestamp to play the audio from that point; click the text to edit it; a small menu to reassign that one turn to the other speaker or split it.
- An audio player bar is pinned at the bottom, and the turn currently playing is highlighted.
- Search box to find words across the transcript.

### F4. AI understanding per question and answer

- Group the transcript into **exchanges**: one counsellor turn followed by the client's reply.
- Beside each exchange, show an insight card with: what the client seems to mean (2–3 sentences), emotions expressed, possible underlying need or concern, a confidence level (low / medium / high), and one suggested follow-up question.
- Each card carries the label "AI interpretation — not a clinical judgement". The counsellor can mark it Agree / Disagree and add their own note.
- A **Session summary** tab: main themes, client's stated goals, key concerns, notable shifts in emotion across the session, and suggested topics for next session.
- Generate insights on demand (button "Generate insights") or automatically after transcription (setting).

### F5. Upload a recording

- Drag-and-drop zone accepting mp3, wav, m4a, ogg, webm, mp4 (audio track), up to 500 MB.
- Same metadata fields and consent checkbox as F2.
- Runs the identical pipeline. Show a progress tracker with stages: Uploading → Converting → Transcribing → Identifying speakers → Ready (→ Generating insights).

### F6. Easy, calm UI

Three main screens: **Sessions** (list), **New session** (Record or Upload tabs), and **Session review** (transcript + insights). Full design rules are in the UI section.

## Data model, API and folders

Four SQLite tables hold everything; audio files live on disk under `data/audio/`.

| Table | Key fields |
| --- | --- |
| `Session` | id, title, client\_code, language, created\_at, duration\_sec, audio\_path, status (`uploading`, `converting`, `transcribing`, `diarizing`, `ready`, `insights`, `failed`), error, counsellor\_speaker (`SPEAKER_00`/`SPEAKER_01`) |
| `Turn` | id, session\_id, index, speaker\_raw, role (`counsellor`/`client`), start, end, text, words\_json (word timings + confidence), edited (bool) |
| `Exchange` | id, session\_id, index, counsellor\_turn\_ids, client\_turn\_ids, insight\_json, counsellor\_feedback (`agree`/`disagree`/null), counsellor\_note |
| `Summary` | session\_id, summary\_json, model\_used, created\_at |

**REST API (FastAPI, prefix `/api`):**

| Method + path | Purpose |
| --- | --- |
| `POST /sessions` | Create session (metadata + consent flag) |
| `POST /sessions/{id}/chunks` | Append a recording chunk |
| `POST /sessions/{id}/finish` | Stop recording, join chunks, start pipeline |
| `POST /sessions/upload` | Upload a file + metadata, start pipeline |
| `GET /sessions` | List sessions |
| `GET /sessions/{id}` | Session with turns and exchanges |
| `GET /sessions/{id}/status` | Pipeline stage + percent (poll every 2 s, or use SSE) |
| `GET /sessions/{id}/audio` | Stream audio with HTTP range support |
| `PATCH /turns/{id}` | Edit text or role |
| `POST /sessions/{id}/swap-roles` | Swap counsellor and client |
| `POST /sessions/{id}/insights` | Generate per-exchange insights + summary |
| `PATCH /exchanges/{id}` | Save agree/disagree and note |
| `GET /sessions/{id}/export?format=pdf\|docx\|txt` | Export verbatim + insights |
| `DELETE /sessions/{id}` | Delete session and its audio |

Long jobs run in a background worker (FastAPI `BackgroundTasks` is enough for one user; use a simple job queue table if needed). One job at a time, because the models use a lot of memory.

**Folder structure:**

```
verbatim/
  SPEC.md
  .env.example
  backend/
    app/
      main.py            # FastAPI app, routes
      models.py          # SQLModel tables
      config.py          # reads .env
      pipeline/
        audio.py         # ffmpeg conversion, chunk joining
        transcribe.py    # WhisperX local / Groq engines
        diarize.py       # pyannote via WhisperX
        turns.py         # merge segments, pauses, exchanges
        roles.py         # counsellor vs client detection
      ai/
        llm.py           # Ollama / Groq client, JSON parsing
        prompts.py       # all prompts in one place
        insights.py
      export.py
    requirements.txt
  frontend/
    src/
      pages/ (Sessions, NewSession, SessionReview)
      components/ (Recorder, UploadZone, TranscriptView, TurnBubble, InsightCard, AudioBar, ProgressSteps)
      api.ts
  data/                  # git-ignored: audio + sqlite
```

## AI prompts

All prompts live in `backend/app/ai/prompts.py`, ask for JSON only, and are validated with Pydantic; on invalid JSON the app retries once, then shows "Insight unavailable". Use temperature 0.2–0.3 for steady output.

### 1. Counsellor vs client detection

First a free heuristic: the speaker who asks more questions (turns ending in "?" or starting with what/how/why/can you/tell me) and who speaks first is likely the counsellor. If the score is close, send the first 20 turns to the LLM:

```
SYSTEM: You label speakers in a counselling session transcript.
One speaker is the COUNSELLOR (asks questions, reflects, guides).
The other is the CLIENT (describes their experiences, feelings, problems).
Return only JSON: {"counsellor": "SPEAKER_00" or "SPEAKER_01", "confidence": 0-1, "reason": "one sentence"}

USER: <first 20 turns as "SPEAKER_XX: text">
```

### 2. Per-exchange understanding

Send each exchange with the previous two exchanges as context, so the model understands references like "that" or "him".

```
SYSTEM: You assist a trained counsellor reviewing their own session.
Read the counsellor's question and the client's reply. Explain what the
client seems to mean, in plain, warm, non-judgemental language.
Rules:
- Stay close to what the client actually said; quote their words as evidence.
- Be tentative ("may", "seems"). Never diagnose or name disorders.
- If the reply is too short or unclear, say so and set confidence to "low".
- If the client mentions self-harm, suicide, abuse or harm to others,
  set risk_flag to true and describe it factually.
Return only JSON:
{
  "client_meaning": "2-3 sentences",
  "evidence": ["short quote from client"],
  "emotions": ["e.g. anxious", "frustrated"],
  "underlying_need": "one sentence",
  "confidence": "low|medium|high",
  "suggested_follow_up": "one open question",
  "risk_flag": false,
  "risk_note": ""
}

USER:
Context (earlier): <previous 2 exchanges>
Counsellor: "<question>"
Client: "<answer>"
```

A `risk_flag` shows a red banner on that exchange and at the top of the session. It never replaces the counsellor's own judgement.

### 3. Session summary

Send the whole transcript if it fits the model's context window. Otherwise send the per-exchange insights instead (they are much shorter).

```
SYSTEM: Summarise this counselling session for the counsellor's notes.
Non-diagnostic, tentative, evidence-based. Return only JSON:
{
  "overview": "3-4 sentences",
  "main_themes": ["..."],
  "client_goals": ["..."],
  "key_concerns": ["..."],
  "emotional_shifts": ["early: ... -> later: ..."],
  "strengths_noticed": ["..."],
  "topics_for_next_session": ["..."],
  "risk_flags": ["..."]
}
```

## UI design guidelines

The interface should feel like a quiet notebook, not a dashboard: soft colours, lots of white space, one clear action per screen.

- **Palette:** warm off-white background (#FAF8F5), dark slate text (#1F2933), sage green accent for buttons (#5B8C7A). Counsellor bubbles in soft blue (#E8F0FB, border #6B9BD2); client bubbles in soft amber (#FDF3E3, border #D9A55B). Risk flags in muted red (#C2504A). Provide a dark mode with the same hues darkened.
- **Type:** Inter or Nunito for UI; transcript text at 17 px with 1.6 line height for comfortable reading.
- **Layout of Session review:** transcript in the left two-thirds, insight cards in a right column that scrolls in sync with the exchange in view. On mobile, insights open as a slide-up panel under each exchange.
- **Colour is never the only signal:** each bubble also carries the text label "Counsellor" or "Client" and a small icon, so colour-blind users can tell them apart.
- **Feedback:** friendly progress stages with a short message ("Listening to the recording…", "Working out who said what…"); toasts for saves; skeleton loaders instead of spinners.
- **Empty states:** the Sessions page with no sessions shows two big cards, "Record a session" and "Upload a recording".
- **Keyboard shortcuts on review:** Space play/pause, J/L back/forward 5 s, E edit current turn.
- **Accessibility:** contrast at least 4.5:1, all buttons reachable by keyboard, visible focus rings.
- Use shadcn/ui components (Button, Card, Tabs, Dialog, Progress, Toast) and lucide-react icons for consistency.

## Privacy, consent and ethics

Counselling recordings are among the most sensitive personal data there is, so privacy is a build requirement, not a later add-on. In India, the Digital Personal Data Protection Act, 2023 applies to this kind of data; check your institution's ethics and supervision rules too.

- **Consent first:** no recording or upload can start until the consent checkbox is ticked. Store the consent time with the session. Provide a printable consent form template that explains recording, AI processing and deletion.
- **Local by default:** `TRANSCRIBE_ENGINE=local` and `LLM_ENGINE=ollama` are the defaults. When a cloud engine is switched on, show a yellow banner on every screen: "Cloud mode: audio/text is sent to a third-party service." Free cloud tiers may log or use data, so read their terms before using real client sessions.
- **No real names:** use client codes. Add an optional "redact names" step that replaces names the counsellor lists with [NAME].
- **App lock:** a single counsellor password (hashed with bcrypt) and the app bound to `127.0.0.1` only, unless deliberately deployed.
- **Encryption at rest:** encrypt audio files with a key from `.env` (Python `cryptography` Fernet), or keep the `data/` folder on an encrypted drive.
- **Retention:** a setting to auto-delete audio after N days while keeping the edited transcript; a clear "Delete session" that removes everything.
- **AI honesty:** every AI output is labelled as an interpretation, never a diagnosis. The counsellor's notes and agree/disagree feedback stay separate from the AI text in exports.

## Build plan for Claude Code

Build in seven phases; paste one prompt at a time and test before moving on. Each phase ends with something you can click and check.

**One-time setup on your machine:** install Python 3.11, Node.js 20+, ffmpeg, and [Ollama](https://ollama.com) (then run `ollama pull qwen2.5:7b`). Create a free Hugging Face account, accept the terms for `pyannote/speaker-diarization-3.1` and `pyannote/segmentation-3.0`, and create an access token. Optional: a free Groq API key for cloud mode.

### Phase 1 — Skeleton

```
Read SPEC.md. Build Phase 1: create the folder structure from the spec,
a FastAPI backend with SQLModel tables (Session, Turn, Exchange, Summary)
and a React + Vite + TypeScript + Tailwind + shadcn/ui frontend with the
three pages (Sessions, New session, Session review) using the UI design
guidelines. Add .env.example, a README with setup steps, and one command
to run both servers. Use placeholder data on the review page.
```

### Phase 2 — Upload and transcription (F5, F1)

```
Build Phase 2: the upload endpoint and UploadZone with the consent checkbox,
ffmpeg conversion to 16 kHz mono WAV, and transcription with WhisperX
(engine and model from .env; add the Groq engine too). Keep fillers using
an initial_prompt, store word timings and confidence, run as a background
job, and show the progress steps in the UI by polling /status.
Test with a short sample file and write a pytest for the pipeline.
```

### Phase 3 — Speaker separation (F3 backend)

```
Build Phase 3: add pyannote diarization through WhisperX with
num_speakers=2 and the HF token from .env. Merge consecutive same-speaker
segments into Turns, add [pause Ns] markers for gaps over 2 seconds,
group Turns into Exchanges, and implement roles.py: question-based
heuristic first, LLM fallback with the prompt in SPEC.md.
```

### Phase 4 — Review screen (F3 frontend)

```
Build Phase 4: the Session review transcript view. Counsellor and client
turns as quoted, labelled, colour-coded bubbles per the UI guidelines,
the pinned audio bar with click-timestamp-to-seek and current-turn
highlight, inline text editing, per-turn reassign speaker, Swap roles
button, search, and keyboard shortcuts.
```

### Phase 5 — Live recording (F2)

```
Build Phase 5: the Recorder component using MediaRecorder with Record,
Pause, Resume, Stop, timer and level meter. Upload 30-second chunks to
/chunks, join them on /finish and start the same pipeline. Warn on tab
close while recording. Require consent before recording starts.
```

### Phase 6 — AI understanding (F4)

```
Build Phase 6: llm.py supporting Ollama and Groq, the per-exchange insight
and session summary prompts from SPEC.md with Pydantic validation and one
retry, InsightCards beside each exchange with Agree/Disagree and notes,
the risk banner, and a Summary tab.
```

### Phase 7 — Polish, privacy, export

```
Build Phase 7: app password, encryption of audio at rest, cloud-mode
banner, retention auto-delete, name redaction, PDF/DOCX/TXT export of the
verbatim with insights, dark mode, empty states, and an accessibility pass.
Then review the whole codebase against SPEC.md and list anything missing.
```

**Tips while building:** if something breaks, paste the full error into Claude Code rather than describing it. Commit to git after each working phase, so you can roll back. Ask Claude Code to explain any part you want to understand before moving on.

## Optional research features and testing

Because the app produces clean, speaker-labelled transcripts, it can double as a research tool for testing neuro-linguistic programming (NLP) claims with natural language processing. Add these after Phase 7, behind a "Research" tab:

- **Sensory predicate tagging:** highlight visual ("see", "clear"), auditory ("sounds", "hear") and kinesthetic ("feel", "grasp") words per speaker, and chart each speaker's proportions across sessions. This tests whether clients have a stable "preferred representational system".
- **Linguistic mirroring score:** measure how much the counsellor's function-word style matches the client's (language style matching, LSM), per exchange and per session. Compare with the counsellor's own rating of rapport.
- **Anonymised export:** a CSV of turns with codes only, for statistical analysis.

**How to check accuracy before trusting it:**

- Pick three real or role-played sessions (with consent). Hand-correct the transcripts and compare: word error rate (WER, use the `jiwer` library) and the share of turns assigned to the wrong speaker.
- Ask two counsellors to rate 20 insight cards for accuracy and usefulness on a 1–5 scale. This also makes good evaluation data if the app becomes part of your research project.
