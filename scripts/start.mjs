// Starts Verbatim and opens it in the browser once it is ready.
// Run with:  npm start   (or double-click "Start Verbatim.bat" / start.sh)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, readEnv, venvPython } from "./venv-python.mjs";

const env = readEnv();
const API = `http://${env.APP_HOST || "127.0.0.1"}:${env.APP_PORT || "8000"}`;
const URL = "http://127.0.0.1:5173";
const isWin = process.platform === "win32";

async function answers(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

// Asking the backend directly (not through the website's proxy) keeps the window free of
// "proxy error" lines while the backend is still starting.
const backendReady = () => answers(`${API}/api/health`);
const websiteReady = () => answers(URL);

function openBrowser() {
  if (process.env.VERBATIM_NO_BROWSER) return;
  if (isWin) {
    // rundll32 opens the default browser without flashing an extra console window.
    spawn("rundll32", ["url.dll,FileProtocolHandler", URL], { stdio: "ignore", detached: true }).unref();
  } else {
    spawn(process.platform === "darwin" ? "open" : "xdg-open", [URL], { stdio: "ignore", detached: true }).unref();
  }
}

const concurrently = join(ROOT, "node_modules", "concurrently", "dist", "bin", "concurrently.js");
if (!venvPython({ exitIfMissing: false }) || !existsSync(concurrently) || !existsSync(join(ROOT, "frontend", "node_modules")) || !existsSync(join(ROOT, ".env"))) {
  console.error("\n  Verbatim is not set up yet. Run \"Setup Verbatim\" first (or: npm run setup).\n");
  process.exit(1);
}

if ((await backendReady()) && (await websiteReady())) {
  console.log(`\n  Verbatim is already running. Opening ${URL}\n`);
  openBrowser();
  process.exit(0);
}

console.log("\n  Starting Verbatim… the browser opens by itself when it is ready.");
console.log("  The first start on a new computer can take a few minutes.");
console.log("  Keep this window open while you use the app. To stop: close it or press Ctrl+C.\n");

// Run both servers through concurrently directly with Node (no shell needed).
const app = spawn(
  process.execPath,
  [concurrently, "-k", "-n", "api,web", "-c", "green,blue", "node scripts/dev-api.mjs", "npm run dev --prefix frontend"],
  { cwd: ROOT, stdio: "inherit" },
);
app.on("exit", (code) => process.exit(code ?? 0));

// Wait as long as it takes; mention it now and then so a slow first start does not look stuck.
const started = Date.now();
let lastNote = started;
while (!((await backendReady()) && (await websiteReady()))) {
  await new Promise((r) => setTimeout(r, 1000));
  if (Date.now() - lastNote > 30_000) {
    lastNote = Date.now();
    console.log(`\n  Still starting (${Math.round((Date.now() - started) / 1000)} s)… this is normal the first time.\n`);
  }
}
console.log(`\n  ✔ Verbatim is ready: ${URL}  (opening your browser)\n`);
openBrowser();
