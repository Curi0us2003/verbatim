// All calls to the FastAPI backend. Vite forwards /api to http://127.0.0.1:8000.
import type {
  AppSettings,
  Exchange,
  Health,
  NoiseLevel,
  Role,
  SessionDetail,
  SessionMeta,
  SessionRecord,
  StatusInfo,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Fired when the backend says the login has expired; the AuthGate shows the lock screen. */
export const UNAUTHORIZED_EVENT = "verbatim:unauthorized";

async function parseError(res: Response): Promise<ApiError> {
  let detail: unknown = null;
  try {
    detail = (await res.json()).detail ?? null;
  } catch {
    /* not JSON */
  }
  // FastAPI always answers with JSON; a non-JSON error comes from the Vite proxy = backend down.
  if (detail === null) return new ApiError(0, "Can't reach the Verbatim backend. Is it running?");
  if (Array.isArray(detail)) detail = detail.map((d) => d.msg).join("; ");
  return new ApiError(res.status, String(detail));
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError(0, "Can't reach the Verbatim backend. Is it running?");
  }
  if (res.status === 401 && !path.startsWith("/auth/")) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<T>;
}

function json(method: string, body?: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) };
}

function metaBody(meta: SessionMeta) {
  return {
    title: meta.title,
    client_code: meta.client_code,
    language: meta.language,
    date: meta.date || null,
    consent: meta.consent,
    noise_reduction: meta.noise_reduction,
  };
}

/** Upload with progress reporting (fetch cannot report upload progress). */
function uploadWithProgress(meta: SessionMeta, file: File, onProgress: (pct: number) => void): Promise<SessionRecord> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    Object.entries(metaBody(meta)).forEach(([k, v]) => v !== null && form.append(k, String(v)));
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/sessions/upload");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress((e.loaded / e.total) * 100);
    xhr.onload = () => {
      let body: { detail?: string } & SessionRecord;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        return reject(new ApiError(0, "Can't reach the Verbatim backend. Is it running?"));
      }
      if (xhr.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      if (xhr.status >= 400) return reject(new ApiError(xhr.status, String(body.detail ?? "Upload failed")));
      resolve(body);
    };
    xhr.onerror = () => reject(new ApiError(0, "The upload was interrupted. Please try again."));
    xhr.send(form);
  });
}

export const api = {
  health: () => request<Health>("/health"),
  llmHealth: () => request<{ ready: boolean; detail: string | null }>("/health/llm"),

  authStatus: () => request<{ has_password: boolean; logged_in: boolean }>("/auth/status"),
  setupPassword: (password: string) => request("/auth/setup", json("POST", { password })),
  login: (password: string) => request("/auth/login", json("POST", { password })),
  logout: () => request("/auth/logout", json("POST")),
  changePassword: (current: string, next: string) => request("/auth/password", json("POST", { current, new: next })),

  getSettings: () => request<AppSettings>("/settings"),
  saveSettings: (changes: Partial<AppSettings>) => request<AppSettings>("/settings", json("PATCH", changes)),

  listSessions: () => request<SessionRecord[]>("/sessions"),
  getSession: (id: number | string) => request<SessionDetail>(`/sessions/${id}`),
  status: (id: number | string) => request<StatusInfo>(`/sessions/${id}/status`),
  createSession: (meta: SessionMeta) => request<SessionRecord>("/sessions", json("POST", metaBody(meta))),
  upload: uploadWithProgress,
  sendChunk: (id: number, index: number, blob: Blob, ext: string) => {
    const form = new FormData();
    form.append("index", String(index));
    form.append("file", blob, `chunk_${index}${ext}`);
    return request<{ ok: boolean }>(`/sessions/${id}/chunks`, { method: "POST", body: form });
  },
  finish: (id: number) => request<SessionRecord>(`/sessions/${id}/finish`, json("POST")),
  deleteSession: (id: number) => request(`/sessions/${id}`, json("DELETE")),
  reprocess: (id: number, noise_reduction: NoiseLevel) =>
    request<SessionRecord>(`/sessions/${id}/reprocess`, json("POST", { noise_reduction })),

  swapRoles: (id: number) => request<SessionDetail>(`/sessions/${id}/swap-roles`, json("POST")),
  generateInsights: (id: number) => request<SessionRecord>(`/sessions/${id}/insights`, json("POST")),
  redact: (id: number, names: string[]) =>
    request<{ replaced: number; session: SessionDetail }>(`/sessions/${id}/redact`, json("POST", { names })),

  updateTurn: (id: number, changes: { text?: string; role?: Role }) =>
    request<SessionDetail>(`/turns/${id}`, json("PATCH", changes)),
  splitTurn: (id: number, at: number) => request<SessionDetail>(`/turns/${id}/split`, json("POST", { at })),
  updateExchange: (
    id: number,
    changes: { counsellor_feedback?: "agree" | "disagree"; clear_feedback?: boolean; counsellor_note?: string },
  ) => request<Exchange>(`/exchanges/${id}`, json("PATCH", changes)),

  audioUrl: (id: number) => `/api/sessions/${id}/audio`,
  exportUrl: (id: number, format: "pdf" | "docx" | "txt") => `/api/sessions/${id}/export?format=${format}`,
};
