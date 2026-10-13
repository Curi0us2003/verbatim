// One-time setup: .env, Python environment + packages (incl. speech models), frontend packages.
// Run with:  npm run setup            (everything)
//            npm run setup -- --core  (skip the ~4 GB speech packages, e.g. when using Groq)
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, copyFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, BACKEND, venvDir, venvPython } from "./venv-python.mjs";

const coreOnly = process.argv.includes("--core");
const isWin = process.platform === "win32";

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: isWin && !cmd.endsWith(".exe"), ...opts });
  if (r.status !== 0) {
    console.error(`\nStep failed: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

function findPython() {
  // WhisperX 3.8 supports Python 3.10–3.13.
  const candidates = [["py", ["-3.13"]], ["py", ["-3.12"]], ["py", ["-3.11"]], ["python3", []], ["python", []]];
  for (const [cmd, pre] of candidates) {
    const r = spawnSync(cmd, [...pre, "--version"], { encoding: "utf8", shell: isWin });
    const version = ((r.stdout || "") + (r.stderr || "")).trim();
    if (r.status === 0 && /Python 3\.(1[0-3])/.test(version)) return { cmd, pre, version };
  }
  console.error("Python 3.10–3.13 was not found. Install Python 3.13 from https://www.python.org/downloads/");
  process.exit(1);
}

// 1. .env with a fresh encryption key
const envFile = join(ROOT, ".env");
if (!existsSync(envFile)) {
  copyFileSync(join(ROOT, ".env.example"), envFile);
  console.log("Created .env from .env.example");
}
let envText = readFileSync(envFile, "utf8");
if (/^ENCRYPTION_KEY=\s*$/m.test(envText)) {
  const key = randomBytes(32).toString("base64url") + "="; // Fernet key format
  envText = envText.replace(/^ENCRYPTION_KEY=\s*$/m, `ENCRYPTION_KEY=${key}`);
  writeFileSync(envFile, envText);
  console.log("Generated an audio encryption key in .env — keep a backup copy of it somewhere safe.");
}

// Keep pip's temporary files next to the environment (useful when the system drive is full).
const venv = venvDir();
const pipTmp = join(venv, "..", "pip-tmp");
mkdirSync(pipTmp, { recursive: true });
const pipEnv = { ...process.env, TMP: pipTmp, TEMP: pipTmp, TMPDIR: pipTmp, PIP_NO_CACHE_DIR: "1" };

// 2. Python environment
if (!venvPython({ exitIfMissing: false })) {
  const py = findPython();
  console.log(`Using ${py.version} to create ${venv}`);
  run(py.cmd, [...py.pre, "-m", "venv", venv]);
} else {
  console.log(`Reusing Python environment at ${venv}`);
}
const python = venvPython();
run(python, ["-m", "pip", "install", "--upgrade", "pip"], { env: pipEnv });
run(python, ["-m", "pip", "install", "-r", join(BACKEND, "requirements.txt")], { env: pipEnv });

// 3. Speech models (WhisperX + pyannote) with the right PyTorch build
// Needed even in Groq mode: speaker separation always runs locally.
if (!coreOnly) {
  const hasNvidia = spawnSync("nvidia-smi", [], { shell: isWin }).status === 0;
  const index = hasNvidia ? "https://download.pytorch.org/whl/cu128" : "https://download.pytorch.org/whl/cpu";
  console.log(hasNvidia ? "\nNVIDIA GPU found: installing GPU PyTorch (~3 GB)." : "\nNo NVIDIA GPU: installing CPU PyTorch.");
  run(python, ["-m", "pip", "install", "torch==2.8.0", "torchaudio==2.8.0", "torchvision==0.23.0", "--index-url", index], { env: pipEnv });
  run(python, ["-m", "pip", "install", "-r", join(BACKEND, "requirements-speech.txt")], { env: pipEnv });
} else {
  console.log("\nSkipping local speech packages (--core). Transcription and speaker separation will not work locally.");
}

// 4. Frontend
run("npm", ["install"], { cwd: join(ROOT, "frontend") });

console.log("\nSetup finished. Start the app with:  npm run dev\n");
