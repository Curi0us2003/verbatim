// One-time setup: Python virtual environment + backend packages, frontend packages, .env file.
// Run with:  npm run setup
import { spawnSync } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, BACKEND, VENV, venvPython } from "./venv-python.mjs";

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (r.status !== 0) {
    console.error(`\nStep failed: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

function findPython() {
  // Prefer Python 3.11 (needed by WhisperX from Phase 2), fall back to any python 3.
  const candidates = [
    ["py", ["-3.11"]],
    ["python3.11", []],
    ["python", []],
    ["python3", []],
  ];
  for (const [cmd, pre] of candidates) {
    const r = spawnSync(cmd, [...pre, "--version"], { encoding: "utf8", shell: process.platform === "win32" });
    if (r.status === 0) {
      const version = (r.stdout || r.stderr).trim();
      return { cmd, pre, version };
    }
  }
  console.error("Python was not found. Install Python 3.11 from https://www.python.org/downloads/");
  process.exit(1);
}

if (!existsSync(VENV)) {
  const py = findPython();
  console.log(`Using ${py.version} to create backend/.venv`);
  if (!py.version.includes("3.11")) {
    console.warn(
      "\nWARNING: Python 3.11 is recommended. Phase 1 works on your version, but the speech\n" +
        "models added in Phase 2 (WhisperX) need 3.11. Install it later and re-run setup\n" +
        "after deleting the backend/.venv folder.\n"
    );
  }
  run(py.cmd, [...py.pre, "-m", "venv", VENV]);
} else {
  console.log("backend/.venv already exists — reusing it.");
}

const python = venvPython();
run(python, ["-m", "pip", "install", "--upgrade", "pip"]);
run(python, ["-m", "pip", "install", "-r", join(BACKEND, "requirements.txt")]);

run("npm", ["install"], { cwd: join(ROOT, "frontend") });

const env = join(ROOT, ".env");
if (!existsSync(env)) {
  copyFileSync(join(ROOT, ".env.example"), env);
  console.log("\nCreated .env from .env.example");
}

console.log("\nSetup finished. Start the app with:  npm run dev\n");
