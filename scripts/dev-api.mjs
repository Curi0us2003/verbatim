// Starts the FastAPI backend using the project's virtual environment.
// `--reload` (used by `npm run dev:watch`) restarts it when backend code changes. It is off for
// normal use: in a OneDrive folder, sync can touch files and restart the server mid-transcription.
import { spawn } from "node:child_process";
import { BACKEND, readEnv, venvPython } from "./venv-python.mjs";

const env = readEnv();
const host = env.APP_HOST || "127.0.0.1";
const port = env.APP_PORT || "8000";
const reload = process.argv.includes("--reload") ? ["--reload", "--reload-dir", "app"] : [];

const child = spawn(
  venvPython(),
  ["-m", "uvicorn", "app.main:app", ...reload, "--timeout-graceful-shutdown", "3", "--host", host, "--port", port],
  { cwd: BACKEND, stdio: "inherit" }
);
child.on("exit", (code) => process.exit(code ?? 0));
