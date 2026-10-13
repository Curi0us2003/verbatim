// Starts the FastAPI backend with auto-reload, using the project's virtual environment.
import { spawn } from "node:child_process";
import { BACKEND, readEnv, venvPython } from "./venv-python.mjs";

const env = readEnv();
const host = env.APP_HOST || "127.0.0.1";
const port = env.APP_PORT || "8000";

const child = spawn(
  venvPython(),
  ["-m", "uvicorn", "app.main:app", "--reload", "--reload-dir", "app", "--host", host, "--port", port],
  { cwd: BACKEND, stdio: "inherit" }
);
child.on("exit", (code) => process.exit(code ?? 0));
