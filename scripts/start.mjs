// Starts Verbatim and opens it in the browser once it is ready.
// Run with:  npm start   (or double-click "Start Verbatim.bat" / start.sh)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, venvPython } from "./venv-python.mjs";

const URL = "http://127.0.0.1:5173";
const isWin = process.platform === "win32";

async function ready() {
  try {
    const res = await fetch(`${URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok; // through the Vite proxy: OK only when both servers are up
  } catch {
    return false;
  }
}

function openBrowser() {
  if (process.env.VERBATIM_NO_BROWSER) return;
  const [cmd, args] = isWin ? ["cmd", ["/c", "start", "", URL]] : process.platform === "darwin" ? ["open", [URL]] : ["xdg-open", [URL]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
}

if (!venvPython({ exitIfMissing: false }) || !existsSync(join(ROOT, "frontend", "node_modules")) || !existsSync(join(ROOT, ".env"))) {
  console.error("\n  Verbatim is not set up yet. Run \"Setup Verbatim\" first (or: npm run setup).\n");
  process.exit(1);
}

if (await ready()) {
  console.log(`\n  Verbatim is already running. Opening ${URL}\n`);
  openBrowser();
  process.exit(0);
}

console.log("\n  Starting Verbatim… the browser opens by itself when it is ready.");
console.log("  Keep this window open while you use the app. To stop: close it or press Ctrl+C.\n");

const app = spawn("npm", ["run", "dev"], { cwd: ROOT, stdio: "inherit", shell: isWin });
app.on("exit", (code) => process.exit(code ?? 0));

const deadline = Date.now() + 3 * 60 * 1000;
(async function waitAndOpen() {
  while (Date.now() < deadline) {
    if (await ready()) {
      console.log(`\n  ✔ Verbatim is ready: ${URL}\n`);
      openBrowser();
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`\n  Verbatim is taking long to start. Look above for errors, or open ${URL} yourself.\n`);
})();
