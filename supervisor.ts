// ═══════════════════════════════════════════════════════════════
//  supervisor.ts — Keeps the bot running 24/7
//  Restarts the bridge after each 270s poll cycle
//  Also ensures the proxy stays alive
// ═══════════════════════════════════════════════════════════════

import { spawn, execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";

const BOT_DIR = "/home/z/my-project/claude-tg-bridge";
const WORK_DIR = "/home/z/my-project";
const LOG_FILE = "/tmp/claude_tg_supervisor.log";
const BRIDGE_LOG = "/tmp/claude_tg_bot.log";
const PROXY_LOG = "/tmp/anthropic_proxy.log";
const PROXY_PORT = 8082;
const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`;

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

async function isProxyAlive(): Promise<boolean> {
  try {
    const resp = await fetch(`${PROXY_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return resp.ok;
  } catch {
    return false;
  }
}

async function ensureProxy() {
  if (await isProxyAlive()) return true;

  log("▶ Starting proxy...");
  const proxyScript = join(BOT_DIR, "anthropic_proxy.ts");
  const child = spawn("bun", ["run", proxyScript], {
    cwd: WORK_DIR,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PROXY_PORT: String(PROXY_PORT) },
  });
  child.unref();

  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isProxyAlive()) {
      log(`✅ Proxy ready (PID: ${child.pid})`);
      return true;
    }
  }
  log("❌ Proxy failed to start");
  return false;
}

async function runBridgeCycle(): Promise<number> {
  return new Promise((resolve) => {
    log("▶ Starting bridge cycle...");
    const bridgeScript = join(BOT_DIR, "tg_bridge.ts");

    // Load .env
    const envPath = join(BOT_DIR, ".env");
    const envVars: Record<string, string> = { ...process.env as any };
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, "utf-8");
      for (const line of envContent.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        envVars[key] = value;
      }
    }
    envVars.WORK_DIR = WORK_DIR;

    const child = spawn("bun", ["run", bridgeScript], {
      cwd: WORK_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: envVars,
      detached: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
      // Also write to bridge log
      try { appendFileSync(BRIDGE_LOG, data.toString()); } catch {}
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
      try { appendFileSync(BRIDGE_LOG, data.toString()); } catch {}
    });

    child.on("close", (code) => {
      log(`Bridge exited (code ${code})`);
      resolve(code || 0);
    });

    child.on("error", (err) => {
      log(`Bridge spawn error: ${err.message}`);
      resolve(-1);
    });
  });
}

// Save PID
writeFileSync("/tmp/claude_tg_supervisor.pid", String(process.pid));

log("════════════════════════════════════════════════");
log("Claude Code TG Bridge — Bun Supervisor Starting");
log(`PID: ${process.pid}`);
log(`Bot dir: ${BOT_DIR}`);
log("════════════════════════════════════════════════");

// Main loop
let cycle = 0;
while (true) {
  cycle++;
  log(`--- Cycle ${cycle} ---`);

  // Ensure proxy alive
  const proxyOk = await ensureProxy();
  if (!proxyOk) {
    log("Proxy down, waiting 30s before retry...");
    await new Promise((r) => setTimeout(r, 30000));
    continue;
  }

  // Run bridge cycle (exits after 270s)
  await runBridgeCycle();

  // Brief pause
  await new Promise((r) => setTimeout(r, 3000));
}
