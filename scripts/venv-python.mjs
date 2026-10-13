// Shared helper: path to the Python inside backend/.venv on Windows, macOS and Linux.
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BACKEND = join(ROOT, "backend");
export const VENV = join(BACKEND, ".venv");

export function venvPython() {
  const win = join(VENV, "Scripts", "python.exe");
  const unix = join(VENV, "bin", "python");
  if (existsSync(win)) return win;
  if (existsSync(unix)) return unix;
  console.error("\nBackend virtual environment not found. Run:  npm run setup\n");
  process.exit(1);
}
