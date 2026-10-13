// Starts the FastAPI backend with auto-reload, using the project's virtual environment.
import { spawn } from "node:child_process";
import { BACKEND, venvPython } from "./venv-python.mjs";

const host = process.env.APP_HOST || "127.0.0.1";
const port = process.env.APP_PORT || "8000";

const child = spawn(
  venvPython(),
  ["-m", "uvicorn", "app.main:app", "--reload", "--reload-dir", "app", "--host", host, "--port", port],
  { cwd: BACKEND, stdio: "inherit" }
);
child.on("exit", (code) => process.exit(code ?? 0));
