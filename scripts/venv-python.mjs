// Shared helpers: project paths, .env reading, and the Python inside the virtual environment.
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BACKEND = join(ROOT, "backend");

/** Minimal .env reader (KEY=value, # comments). */
export function readEnv() {
  const env = {};
  const file = join(ROOT, ".env");
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#]*?)\s*(#.*)?$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

/** VENV_DIR from .env (may be on another drive), otherwise backend/.venv. */
export function venvDir() {
  const fromEnv = process.env.VENV_DIR || readEnv().VENV_DIR;
  if (fromEnv) return isAbsolute(fromEnv) ? fromEnv : join(ROOT, fromEnv);
  return join(BACKEND, ".venv");
}

export function venvPython({ exitIfMissing = true } = {}) {
  const venv = venvDir();
  const win = join(venv, "Scripts", "python.exe");
  const unix = join(venv, "bin", "python");
  if (existsSync(win)) return win;
  if (existsSync(unix)) return unix;
  if (!exitIfMissing) return null;
  console.error(`\nPython environment not found at ${venv}. Run:  npm run setup\n`);
  process.exit(1);
}
