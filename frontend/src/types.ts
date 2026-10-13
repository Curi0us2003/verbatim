// Mirrors the SQLModel tables in backend/app/models.py.

export type SessionStatus =
  | "uploading"
  | "converting"
  | "transcribing"
  | "diarizing"
  | "ready"
  | "insights"
  | "failed";

export type Role = "counsellor" | "client";

export interface Word {
  word: string;
  start: number | null;
  end: number | null;
  score: number | null; // confidence 0–1; below 0.4 is shown as unclear
}

export interface Turn {
  id: number;
  session_id: number;
  index: number;
  speaker_raw: string;
  role: Role;
  start: number;
  end: number;
  text: string;
  words_json: Word[];
  edited: boolean;
}

export interface Insight {
  client_meaning: string;
  evidence: string[];
  emotions: string[];
  underlying_need: string;
  confidence: "low" | "medium" | "high";
  suggested_follow_up: string;
  risk_flag: boolean;
  risk_note: string;
}

export interface Exchange {
  id: number;
  session_id: number;
  index: number;
  counsellor_turn_ids: number[];
  client_turn_ids: number[];
  insight_json: Insight | null;
  counsellor_feedback: "agree" | "disagree" | null;
  counsellor_note: string | null;
}

export interface SummaryData {
  overview: string;
  main_themes: string[];
  client_goals: string[];
  key_concerns: string[];
  emotional_shifts: string[];
  strengths_noticed: string[];
  topics_for_next_session: string[];
  risk_flags: string[];
}

export interface Summary {
  session_id: number;
  summary_json: SummaryData;
  model_used: string;
  created_at: string;
}

export interface SessionRecord {
  id: number;
  title: string;
  client_code: string;
  language: string;
  created_at: string;
  consent_at: string | null;
  duration_sec: number | null;
  status: SessionStatus;
  error: string | null;
  counsellor_speaker: string | null;
}

export interface SessionDetail extends SessionRecord {
  turns: Turn[];
  exchanges: Exchange[];
  summary: Summary | null;
}

export interface Health {
  status: string;
  transcribe_engine: "local" | "groq";
  llm_engine: "ollama" | "groq";
  cloud_mode: boolean;
}

/** Metadata the counsellor fills in before recording or uploading (F2, F5). */
export interface SessionMeta {
  title: string;
  client_code: string;
  language: string;
  date: string; // yyyy-mm-dd
  consent: boolean;
}
