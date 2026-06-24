// ═══════════════════════════════════════════════════════════════
//  tg_bridge.ts — Telegram → Claude Code Bridge
//
//  Spawns Claude Code with GLM-5.2-plus (via the local Anthropic proxy)
//  and bridges messages between Telegram and Claude Code.
//
//  Features:
//  • Spawns Claude Code in interactive mode (--print for each message)
//  • Sends/receives text, images, voice, files
//  • 24/7 cron mode (270s poll)
//  • Auto-starts the anthropic_proxy.ts if not running
//  • User choice only — no model fallback (respects user selection)
// ═══════════════════════════════════════════════════════════════

import { execSync, spawn } from "child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  readdirSync,
  unlinkSync,
} from "fs";
import { join, basename } from "path";

// ═══════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════

const WORK_DIR = process.env.WORK_DIR || "/home/z/my-project";
const DOWNLOAD_DIR = join(WORK_DIR, "download");
const UPLOAD_DIR = join(WORK_DIR, "upload");
const LOG_FILE = join(WORK_DIR, "claude_bot.log");
const STATE_DIR = join(WORK_DIR, "agent_state");
const SESSIONS_DIR = join(STATE_DIR, "claude_sessions");
const MAX_POLL = 270;
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "8082");
const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`;

// Model — glm-5.2-plus default. User choice only, no fallback.
const DEFAULT_MODEL = "glm-5.2-plus";
const MODEL_FILE = join(STATE_DIR, "current_model.json");

const TG_TOKEN = process.env.TG_TOKEN || "";
const TG_USER_ID = process.env.TG_USER_ID || "";
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;
const TG_OFFSET_FILE = join(STATE_DIR, "tg_offset.json");

// ═══════════════════════════════════════════════════════════════
//  AVAILABLE MODELS — User can switch between any of these
// ═══════════════════════════════════════════════════════════════

const AVAILABLE_MODELS = [
  // GLM-5 series
  { name: "glm-5.2-plus", desc: "⭐ DEFAULT — Premium flagship", ctx: "128K" },
  { name: "glm-5.2", desc: "🚀 Fast flagship", ctx: "128K" },
  { name: "glm-5.2-air", desc: "Lighter 5.2", ctx: "128K" },
  { name: "glm-5.2-flash", desc: "⚡ Free tier 5.2", ctx: "128K" },
  { name: "glm-5.2x", desc: "Extreme 5.2 — long outputs", ctx: "128K" },
  { name: "glm-5.2v", desc: "👁️ Vision 5.2", ctx: "128K" },
  { name: "glm-5", desc: "Base 5 series", ctx: "128K" },
  { name: "glm-5-plus", desc: "Premium 5", ctx: "128K" },
  { name: "glm-5-air", desc: "Light 5", ctx: "128K" },
  { name: "glm-5-flash", desc: "⚡ Free 5", ctx: "128K" },
  { name: "glm-5v", desc: "👁️ Vision 5", ctx: "128K" },
  { name: "glm-5v-plus", desc: "👁️ Premium Vision 5", ctx: "8K" },
  // GLM-4 series
  { name: "glm-4.6", desc: "Previous flagship", ctx: "128K" },
  { name: "glm-4.5", desc: "Strong 4.5", ctx: "128K" },
  { name: "glm-4.5-air", desc: "Fast 4.5", ctx: "128K" },
  { name: "glm-4.5x", desc: "Long-output 4.5", ctx: "128K" },
  { name: "glm-4.5v", desc: "👁️ Vision 4.5", ctx: "128K" },
  { name: "glm-4-long", desc: "📚 1M token context", ctx: "1M" },
  { name: "glm-4v-plus", desc: "👁️ Best vision in 4 series", ctx: "8K" },
  { name: "glm-4-flash", desc: "⚡ Free fast 4", ctx: "128K" },
  // Reasoning
  { name: "glm-zero", desc: "🧠 Reasoning (o1-style)", ctx: "128K" },
  { name: "glm-zero-preview", desc: "🧠 Reasoning preview", ctx: "128K" },
  { name: "glm-zero-1", desc: "🧠 Reasoning v1", ctx: "128K" },
];

function getCurrentModel(): string {
  try {
    if (existsSync(MODEL_FILE)) {
      return JSON.parse(readFileSync(MODEL_FILE, "utf-8")).model || DEFAULT_MODEL;
    }
  } catch {}
  return DEFAULT_MODEL;
}

function setCurrentModel(model: string): boolean {
  const valid = AVAILABLE_MODELS.some((m) => m.name === model);
  if (!valid) return false;
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(MODEL_FILE, JSON.stringify({ model, updated: Date.now() }), "utf-8");
  return true;
}

function formatModelsList(): string {
  const current = getCurrentModel();
  let out = `🤖 *Available Models* (Claude Code via GLM)\n_Current: \`${current}\`_\n\n`;
  out += `*GLM-5 Series (Latest Flagship)*\n`;
  AVAILABLE_MODELS.slice(0, 12).forEach((m) => {
    const icon = m.name === current ? "✅" : "  ";
    out += `${icon} \`${m.name}\` — ${m.desc}\n`;
  });
  out += `\n*GLM-4 Series*\n`;
  AVAILABLE_MODELS.slice(12, 20).forEach((m) => {
    const icon = m.name === current ? "✅" : "  ";
    out += `${icon} \`${m.name}\` — ${m.desc}\n`;
  });
  out += `\n*Reasoning Models*\n`;
  AVAILABLE_MODELS.slice(20).forEach((m) => {
    const icon = m.name === current ? "✅" : "  ";
    out += `${icon} \`${m.name}\` — ${m.desc}\n`;
  });
  out += `\n*Switch with:* \`/model <name>\`\n*Note: No fallback. User choice only.*`;
  return out;
}

// ═══════════════════════════════════════════════════════════════
//  LOGGING
// ═══════════════════════════════════════════════════════════════

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

// ═══════════════════════════════════════════════════════════════
//  PROXY MANAGEMENT — auto-start anthropic_proxy.ts if down
// ═══════════════════════════════════════════════════════════════

async function isProxyAlive(): Promise<boolean> {
  try {
    const resp = await fetch(`${PROXY_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return resp.ok;
  } catch {
    return false;
  }
}

async function ensureProxyRunning() {
  if (await isProxyAlive()) return;

  log("Proxy not running — starting it...");
  const proxyScript = join(WORK_DIR, "claude-tg-bridge", "anthropic_proxy.ts");
  if (!existsSync(proxyScript)) {
    log(`ERROR: Proxy script not found: ${proxyScript}`);
    return;
  }

  // Spawn detached
  const child = spawn(
    "bun",
    ["run", proxyScript],
    {
      cwd: WORK_DIR,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        PROXY_PORT: String(PROXY_PORT),
      },
    }
  );
  child.unref();

  // Wait for it to come up
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isProxyAlive()) {
      log(`✅ Proxy started (PID: ${child.pid})`);
      return;
    }
  }
  log("❌ Proxy failed to start within 10s");
}

// ═══════════════════════════════════════════════════════════════
//  CLAUDE CODE EXECUTION
// ═══════════════════════════════════════════════════════════════

interface ClaudeResult {
  text: string;
  exitCode: number;
  duration: number;
}

/** Run Claude Code with a prompt, return response text */
async function runClaudeCode(
  prompt: string,
  options: {
    cwd?: string;
    timeoutSec?: number;
    imagePaths?: string[];
    sessionContinue?: boolean;
  } = {}
): Promise<ClaudeResult> {
  const cwd = options.cwd || WORK_DIR;
  const timeoutSec = options.timeoutSec || 240;
  const model = getCurrentModel();

  // Build the prompt with image info if any
  let fullPrompt = prompt;
  if (options.imagePaths && options.imagePaths.length > 0) {
    fullPrompt += `\n\n[User sent ${options.imagePaths.length} image(s) at: ${options.imagePaths.join(", ")} — use Read tool to view them]`;
  }

  const startTime = Date.now();

  return new Promise<ClaudeResult>((resolve) => {
    const args = [
      "--print",
      "--bare",
      "--dangerously-skip-permissions",
      "--model", model,
      "--settings", JSON.stringify({
        env: {
          CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
          CLAUDE_CODE_ENABLE_TELEMETRY: "0",
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        },
      }),
      fullPrompt,
    ];

    log(`  Spawning claude ${model} (timeout ${timeoutSec}s)`);

    const child = spawn("claude", args, {
      cwd,
      env: {
        ...process.env,
        ANTHROPIC_BASE_URL: PROXY_URL,
        ANTHROPIC_API_KEY: "dummy",
        ANTHROPIC_MODEL: model,
        CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
        CLAUDE_CODE_ENABLE_TELEMETRY: "0",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
      }, 5000);
    }, timeoutSec * 1000);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const duration = Math.round((Date.now() - startTime) / 1000);

      if (killed) {
        log(`  Claude timed out after ${duration}s`);
        resolve({
          text: stdout.trim() || `⏱️ Timed out after ${timeoutSec}s. Partial output:\n\n${stderr.slice(0, 500)}`,
          exitCode: -1,
          duration,
        });
        return;
      }

      if (code !== 0 && !stdout) {
        log(`  Claude exited ${code} with stderr: ${stderr.slice(0, 200)}`);
        resolve({
          text: `❌ Claude Code error (exit ${code}):\n${stderr.slice(0, 1000)}`,
          exitCode: code || -1,
          duration,
        });
        return;
      }

      log(`  Claude done in ${duration}s, ${stdout.length} chars`);
      resolve({
        text: stdout.trim(),
        exitCode: code || 0,
        duration,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      log(`  Claude spawn error: ${err.message}`);
      resolve({
        text: `❌ Failed to spawn Claude Code: ${err.message}`,
        exitCode: -1,
        duration: Math.round((Date.now() - startTime) / 1000),
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════════
//  TELEGRAM SEND HELPERS
// ═══════════════════════════════════════════════════════════════

function getTgOffset(): number {
  try {
    if (existsSync(TG_OFFSET_FILE))
      return JSON.parse(readFileSync(TG_OFFSET_FILE, "utf-8")).offset || 0;
  } catch {}
  return 0;
}

function saveTgOffset(offset: number) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(TG_OFFSET_FILE, JSON.stringify({ offset }), "utf-8");
}

async function tgSendText(chatId: string, text: string, parseMode?: string) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 4000) chunks.push(text.slice(i, i + 4000));
  for (const chunk of chunks) {
    try {
      const body: any = { chat_id: chatId, text: chunk };
      if (parseMode) body.parse_mode = parseMode;
      await fetch(`${TG_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {}
  }
}

async function tgSendDocument(chatId: string, filepath: string, caption?: string) {
  if (!existsSync(filepath)) return;
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append(
    "document",
    new Blob([readFileSync(filepath)], { type: "application/octet-stream" }),
    basename(filepath)
  );
  if (caption) formData.append("caption", caption.slice(0, 1000));
  try {
    await fetch(`${TG_API}/sendDocument`, { method: "POST", body: formData });
    log(`Sent: ${basename(filepath)}`);
  } catch {}
}

async function tgSendPhoto(chatId: string, filepath: string, caption?: string) {
  if (!existsSync(filepath)) return;
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append(
    "photo",
    new Blob([readFileSync(filepath)], { type: "image/png" }),
    basename(filepath)
  );
  if (caption) formData.append("caption", caption.slice(0, 1000));
  try {
    await fetch(`${TG_API}/sendPhoto`, { method: "POST", body: formData });
  } catch {}
}

async function tgDownloadFile(fileId: string, savePath: string): Promise<boolean> {
  try {
    const resp = await fetch(`${TG_API}/getFile?file_id=${fileId}`);
    const data = await resp.json();
    if (!data.ok || !data.result?.file_path) return false;
    const fileUrl = `https://api.telegram.org/file/bot${TG_TOKEN}/${data.result.file_path}`;
    const fileResp = await fetch(fileUrl);
    if (!fileResp.ok) return false;
    const buf = Buffer.from(await fileResp.arrayBuffer());
    writeFileSync(savePath, buf);
    return true;
  } catch {
    return false;
  }
}

/** Find newly created files in a directory (modified after timestamp) */
function findNewFiles(dir: string, afterTimestamp: number): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => {
        const stat = existsSync(join(dir, f)) ? stat_lite(join(dir, f)) : null;
        return stat && stat > afterTimestamp;
      })
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

function stat_lite(path: string): number | null {
  try {
    // Use execSync since we don't have statSync imported
    return parseInt(execSync(`stat -c %Y "${path}" 2>/dev/null || echo 0`).toString().trim()) * 1000;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════

async function handleTgMessage(msg: any) {
  const chatId = msg.chat.id;
  const fromId = String(msg.from?.id);
  if (fromId !== TG_USER_ID) return;

  const text = msg.text || msg.caption || "";

  // ─── COMMANDS ──────────────────────────────────────────
  if (text === "/start" || text === "/help") {
    await tgSendText(
      chatId,
      `🤖 *Claude Code via Telegram — GLM-5.2-Plus*\n\n` +
        `*Real Claude Code CLI* running with GLM-5.2-Plus model.\n\n` +
        `⚡ *What Claude Code can do:*\n` +
        `• 📁 Read, write, edit files\n` +
        `• 💻 Run bash commands\n` +
        `• 🔍 Search codebases (grep, glob)\n` +
        `• 🌿 Git operations\n` +
        `• 📝 Write entire codebases\n` +
        `• 🐛 Debug and fix code\n` +
        `• 📊 Generate documents\n` +
        `• 🎨 Build web apps\n` +
        `• 🤖 Multi-step agentic tasks\n\n` +
        `💬 *Send any message* — Claude Code will execute it\n` +
        `📸 *Send image* — Claude can read it\n` +
        `📄 *Send file* — Claude can process it\n\n` +
        `*Commands:*\n` +
        `/models — List all GLM models\n` +
        `/model <name> — Switch model\n` +
        `/status — System status\n` +
        `/cd <path> — Change working dir\n` +
        `/pwd — Show current dir`,
      "Markdown"
    );
    return;
  }

  if (text === "/models") {
    await tgSendText(chatId, formatModelsList(), "Markdown");
    return;
  }

  if (text.startsWith("/model ")) {
    const modelName = text.slice(7).trim().toLowerCase();
    if (setCurrentModel(modelName)) {
      await tgSendText(
        chatId,
        `✅ Model switched to \`${modelName}\`\n\nNo fallback. Only this model will be used.`,
        "Markdown"
      );
    } else {
      await tgSendText(
        chatId,
        `❌ Invalid model: \`${modelName}\`\n\nUse \`/models\` to see available options.`,
        "Markdown"
      );
    }
    return;
  }

  if (text === "/status") {
    const proxyAlive = await isProxyAlive();
    const model = getCurrentModel();
    let out = `📊 *System Status*\n\n`;
    out += `🤖 Claude Code: 2.1.x\n`;
    out += `🧠 Model: \`${model}\`\n`;
    out += `🔌 Proxy: ${proxyAlive ? "✅ running" : "❌ down"}\n`;
    out += `🌐 Proxy URL: \`${PROXY_URL}\`\n`;
    out += `📁 Working dir: \`${currentWorkDir}\`\n`;
    out += `⏱️ Uptime: ${Math.round(process.uptime())}s`;
    await tgSendText(chatId, out, "Markdown");
    return;
  }

  if (text === "/pwd") {
    await tgSendText(chatId, `📁 \`${currentWorkDir}\``, "Markdown");
    return;
  }

  if (text.startsWith("/cd ")) {
    const newDir = text.slice(4).trim();
    const resolved = newDir.startsWith("/") ? newDir : join(currentWorkDir, newDir);
    if (existsSync(resolved)) {
      currentWorkDir = resolved;
      await tgSendText(chatId, `✅ Changed to \`${currentWorkDir}\``, "Markdown");
    } else {
      await tgSendText(chatId, `❌ Directory not found: \`${resolved}\``, "Markdown");
    }
    return;
  }

  await tgSendText(chatId, "⏳ Claude Code working...");

  // Process media if any
  let userPrompt = text;
  const imagePaths: string[] = [];

  if (msg.photo) {
    const largest = msg.photo[msg.photo.length - 1];
    const imgPath = join(UPLOAD_DIR, `tg_img_${Date.now()}.jpg`);
    if (await tgDownloadFile(largest.file_id, imgPath)) {
      imagePaths.push(imgPath);
      if (!userPrompt) userPrompt = "Analyze this image.";
      log(`Received image: ${imgPath}`);
    }
  } else if (msg.document) {
    const docName = msg.document.file_name || "file";
    const docPath = join(UPLOAD_DIR, `tg_doc_${Date.now()}_${docName}`);
    if (await tgDownloadFile(msg.document.file_id, docPath)) {
      log(`Received file: ${docName}`);
      // Read text files inline
      const textExts = [".txt", ".md", ".json", ".csv", ".ts", ".js", ".py", ".html", ".css", ".yaml", ".yml", ".xml", ".sh", ".log", ".tsx", ".jsx"];
      if (textExts.some((ext) => docName.toLowerCase().endsWith(ext))) {
        try {
          const content = readFileSync(docPath, "utf-8").slice(0, 5000);
          userPrompt = `${text || "Process this file."}\n\n[User sent file: ${docName}]\n\n\`\`\`\n${content}\n\`\`\``;
        } catch {
          userPrompt = `${text || "Process this file."}\n\n[User sent file at ${docPath} — use Read tool]`;
        }
      } else {
        userPrompt = `${text || "Process this file."}\n\n[User sent file at ${docPath} — use Read tool to view]`;
      }
    }
  } else if (msg.voice) {
    // Voice messages need transcription — Claude Code doesn't have ASR
    // Use Z.AI SDK for ASR
    const voicePath = join(UPLOAD_DIR, `tg_voice_${Date.now()}.ogg`);
    if (await tgDownloadFile(msg.voice.file_id, voicePath)) {
      log(`Received voice: ${voicePath}`);
      await tgSendText(chatId, "🎤 Transcribing...");
      try {
        const ZAI = (await import("z-ai-web-dev-sdk")).default;
        const zai = await ZAI.create();
        const base64 = readFileSync(voicePath).toString("base64");
        const transcription = await zai.audio.asr.create({ file_base64: base64 });
        const transText = typeof transcription === "string"
          ? transcription
          : transcription?.text || transcription?.result || JSON.stringify(transcription);
        userPrompt = `[User sent a voice message]: "${transText}"`;
        log(`Transcribed: ${transText.slice(0, 100)}`);
      } catch (err: any) {
        userPrompt = `[User sent a voice message but transcription failed] ${text}`;
      }
    }
  }

  if (!userPrompt || userPrompt.trim() === "") return;

  // Track files created in download dir before
  const beforeTs = Date.now();

  // Run Claude Code
  const result = await runClaudeCode(userPrompt, {
    cwd: currentWorkDir,
    timeoutSec: 240,
    imagePaths,
  });

  // Send response
  let responseText = result.text;
  if (result.duration > 5) {
    responseText = `${responseText}\n\n_⏱️ ${result.duration}s_`;
  }
  await tgSendText(chatId, responseText);

  // Find newly created files in download dir
  const newFiles = findNewFiles(DOWNLOAD_DIR, beforeTs);
  for (const fp of newFiles.slice(0, 10)) {
    const ext = fp.toLowerCase();
    if (ext.endsWith(".png") || ext.endsWith(".jpg") || ext.endsWith(".jpeg")) {
      await tgSendPhoto(chatId, fp);
    } else {
      await tgSendDocument(chatId, fp);
    }
  }
}

let currentWorkDir = WORK_DIR;

// ═══════════════════════════════════════════════════════════════
//  TELEGRAM POLL LOOP
// ═══════════════════════════════════════════════════════════════

async function tgPollOnce() {
  const offset = getTgOffset();
  const url = `${TG_API}/getUpdates?offset=${offset}&limit=10&timeout=25`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.ok) {
      log(`TG API error: ${data.description}`);
      return;
    }

    let newOffset = offset;
    const updates = data.result || [];

    for (const update of updates) {
      if (update.update_id + 1 > newOffset) newOffset = update.update_id + 1;
      if (!update.message) continue;

      const msg = update.message;
      log(`TG MSG from ${msg.from?.id}: ${(msg.text || msg.caption || "?").toString().slice(0, 80)}`);

      try {
        await handleTgMessage(msg);
      } catch (err: any) {
        log(`Handle error: ${err.message?.slice(0, 200)}`);
        try {
          await tgSendText(msg.chat.id, `❌ Error: ${err.message?.slice(0, 300)}`);
        } catch {}
      }
    }

    if (newOffset > offset) saveTgOffset(newOffset);
  } catch (err: any) {
    log(`TG Poll error: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  // Ensure dirs
  for (const dir of [WORK_DIR, DOWNLOAD_DIR, UPLOAD_DIR, STATE_DIR, SESSIONS_DIR]) {
    mkdirSync(dir, { recursive: true });
  }

  // Check Claude Code is installed
  try {
    const version = execSync("claude --version", { encoding: "utf-8" }).trim();
    log(`Claude Code version: ${version}`);
  } catch {
    log("ERROR: Claude Code not installed. Run: npm install -g @anthropic-ai/claude-code");
    process.exit(1);
  }

  // Check Telegram config
  if (!TG_TOKEN || !TG_USER_ID) {
    log("ERROR: Set TG_TOKEN and TG_USER_ID in .env");
    process.exit(1);
  }

  // Ensure proxy is running
  await ensureProxyRunning();

  log("════════════════════════════════════════════════");
  log("Claude Code Telegram Bridge — Starting");
  log(`User ID: ${TG_USER_ID}`);
  log(`Default model: ${getCurrentModel()} (no fallback)`);
  log(`Proxy: ${PROXY_URL}`);
  log(`Working dir: ${currentWorkDir}`);
  log(`Poll duration: ${MAX_POLL}s`);
  log("════════════════════════════════════════════════");

  const startTime = Date.now();
  while (Date.now() - startTime < MAX_POLL * 1000) {
    // Ensure proxy is alive each cycle
    if (!(await isProxyAlive())) {
      log("Proxy died — restarting...");
      await ensureProxyRunning();
    }

    await tgPollOnce();
  }

  log("Poll duration reached, exiting...");
}

main().catch((err) => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
