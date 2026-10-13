// All calls to the FastAPI backend. Vite forwards /api to http://127.0.0.1:8000.
import type { Health, SessionDetail, SessionRecord } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, "Can't reach the Verbatim backend. Is it running?");
  }
  if (!res.ok) {
    let detail: string | null = null;
    try {
      detail = (await res.json()).detail ?? null;
    } catch {
      /* not JSON */
    }
    // FastAPI always answers with JSON. A non-JSON error comes from the Vite proxy,
    // which means FastAPI is not running.
    if (detail === null) {
      throw new ApiError(0, "Can't reach the Verbatim backend. Is it running?");
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<Health>("/health"),
  listSessions: () => request<SessionRecord[]>("/sessions"),
  getSession: (id: number | string) => request<SessionDetail>(`/sessions/${id}`),
};
