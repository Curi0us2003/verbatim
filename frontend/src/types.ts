// Mirrors the models in backend/app/models.py.

export type SessionStatus =
  | "uploading"
  | "converting"
  | "transcribing"
  | "diarizing"
  | "ready"
  | "insights"
  | "failed";

export type Role = "counsellor" | "client";
export type NoiseLevel = "off" | "light" | "strong";

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
  /** Voice analysis: 0.5 = could be either speaker, 1.0 = certain or confirmed. null = not checked. */
  speaker_confidence: number | null;
}

/** Below this, a turn shows a "check speaker" flag (matches UNSURE_BELOW in voices.py). */
export const SPEAKER_UNSURE_BELOW = 0.65;

export interface VoiceCheck {
  used: boolean;
  diarized: boolean;
  corrected: number;
  uncertain_turns?: number;
  counsellor_by?: string;
  counsellor_label?: string;
  reason?: string;
  error?: string;
}

export interface VoiceInfo {
  enrolled: boolean;
  seconds?: number;
  source?: string;
  updated_at?: string;
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

/** Stored when the AI gave invalid JSON twice (SPEC: show "Insight unavailable"). */
export interface InsightUnavailable {
  unavailable: true;
  error: string;
  detail?: string;
}

export interface Exchange {
  id: number;
  session_id: number;
  index: number;
  counsellor_turn_ids: number[];
  client_turn_ids: number[];
  insight_json: Insight | InsightUnavailable | null;
  counsellor_feedback: "agree" | "disagree" | null;
  counsellor_note: string | null;
}

export function isInsight(value: Exchange["insight_json"]): value is Insight {
  return !!value && "client_meaning" in value;
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
  detected_language: string | null;
  created_at: string;
  consent_at: string | null;
  duration_sec: number | null;
  status: SessionStatus;
  error: string | null;
  warning: string | null;
  counsellor_speaker: string | null;
  noise_reduction: NoiseLevel;
  has_audio: boolean;
  audio_deleted_at: string | null;
  voice_check: VoiceCheck | null;
}

export interface SessionDetail extends SessionRecord {
  turns: Turn[];
  exchanges: Exchange[];
  summary: Summary | null;
}

export interface StatusInfo {
  status: SessionStatus;
  percent: number;
  error: string | null;
  warning: string | null;
}

export interface Health {
  status: string;
  transcribe_engine: "local" | "groq";
  llm_engine: "ollama" | "groq";
  cloud_mode: boolean;
  checks: {
    ffmpeg: boolean;
    whisperx: boolean;
    hf_token: boolean;
    encryption: boolean;
    voice_check: boolean;
    whisper_model: string;
    llm_model: string;
  };
}

export interface AppSettings {
  retention_days: number;
  auto_insights: boolean;
  noise_reduction: NoiseLevel;
}

/** Metadata the counsellor fills in before recording or uploading (F2, F5). */
export interface SessionMeta {
  title: string;
  client_code: string;
  language: string;
  date: string; // yyyy-mm-dd
  consent: boolean;
  noise_reduction: NoiseLevel;
}
