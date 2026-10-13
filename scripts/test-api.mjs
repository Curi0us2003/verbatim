// Runs the backend tests with pytest inside the project's virtual environment.
import { spawnSync } from "node:child_process";
import { BACKEND, venvPython } from "./venv-python.mjs";

const r = spawnSync(venvPython(), ["-m", "pytest", "-q", ...process.argv.slice(2)], {
  cwd: BACKEND,
  stdio: "inherit",
});
process.exit(r.status ?? 1);
