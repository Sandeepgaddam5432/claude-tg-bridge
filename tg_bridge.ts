// ═══════════════════════════════════════════════════════════════
//  tg_bridge.ts — Telegram → Claude Code Bridge
//
//  Real Claude Code CLI bridged to Telegram via local proxy.
//  The proxy translates Anthropic Messages API → OpenAI Chat Completions.
//  Backend: Z.AI proxy serves GLM (whatever model it currently routes to).
//
//  No model picker, no fallback — just works.
// ═══════════════════════════════════════════════════════════════

import { execSync, spawn } from "child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  readdirSync,
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
const MAX_POLL = 270;
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "8082");
const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`;

// Single model — the one Z.AI proxy serves. No picker, no fallback.
const MODEL = process.env.GLM_MODEL || "glm-5.2-plus";

const TG_TOKEN = process.env.TG_TOKEN || "";
const TG_USER_ID = process.env.TG_USER_ID || "";
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;
const TG_OFFSET_FILE = join(STATE_DIR, "tg_offset.json");

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
//  PROXY MANAGEMENT
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
  const child = spawn("bun", ["run", proxyScript], {
    cwd: WORK_DIR,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PROXY_PORT: String(PROXY_PORT) },
  });
  child.unref();
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

async function runClaudeCode(
  prompt: string,
  options: {
    cwd?: string;
    timeoutSec?: number;
    imagePaths?: string[];
  } = {}
): Promise<ClaudeResult> {
  const cwd = options.cwd || WORK_DIR;
  const timeoutSec = options.timeoutSec || 240;

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
      "--model", MODEL,
      "--settings", JSON.stringify({
        env: {
          CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
          CLAUDE_CODE_ENABLE_TELEMETRY: "0",
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        },
      }),
      fullPrompt,
    ];

    log(`  Spawning claude (timeout ${timeoutSec}s)`);

    const child = spawn("claude", args, {
      cwd,
      env: {
        ...process.env,
        ANTHROPIC_BASE_URL: PROXY_URL,
        ANTHROPIC_API_KEY: "dummy",
        ANTHROPIC_MODEL: MODEL,
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
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5000);
    }, timeoutSec * 1000);

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("close", (code) => {
      clearTimeout(timer);
      const duration = Math.round((Date.now() - startTime) / 1000);
      if (killed) {
        resolve({
          text: stdout.trim() || `⏱️ Timed out after ${timeoutSec}s.`,
          exitCode: -1,
          duration,
        });
        return;
      }
      if (code !== 0 && !stdout) {
        resolve({
          text: `❌ Claude Code error (exit ${code}):\n${stderr.slice(0, 1000)}`,
          exitCode: code || -1,
          duration,
        });
        return;
      }
      log(`  Claude done in ${duration}s, ${stdout.length} chars`);
      resolve({ text: stdout.trim(), exitCode: code || 0, duration });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        text: `❌ Failed to spawn Claude Code: ${err.message}`,
        exitCode: -1,
        duration: Math.round((Date.now() - startTime) / 1000),
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════════
//  TELEGRAM HELPERS
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
  formData.append("document", new Blob([readFileSync(filepath)], { type: "application/octet-stream" }), basename(filepath));
  if (caption) formData.append("caption", caption.slice(0, 1000));
  try { await fetch(`${TG_API}/sendDocument`, { method: "POST", body: formData }); log(`Sent: ${basename(filepath)}`); } catch {}
}

async function tgSendPhoto(chatId: string, filepath: string, caption?: string) {
  if (!existsSync(filepath)) return;
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("photo", new Blob([readFileSync(filepath)], { type: "image/png" }), basename(filepath));
  if (caption) formData.append("caption", caption.slice(0, 1000));
  try { await fetch(`${TG_API}/sendPhoto`, { method: "POST", body: formData }); } catch {}
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
  } catch { return false; }
}

function findNewFiles(dir: string, afterTimestamp: number): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => {
        const path = join(dir, f);
        try {
          const stat = execSync(`stat -c %Y "${path}" 2>/dev/null || echo 0`).toString().trim();
          return parseInt(stat) * 1000 > afterTimestamp;
        } catch { return false; }
      })
      .map((f) => join(dir, f));
  } catch { return []; }
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
      `🤖 *Claude Code via Telegram*\n\n` +
        `Real Claude Code CLI running with GLM via Z.AI proxy.\n\n` +
        `⚡ *What Claude Code can do:*\n` +
        `• 📁 Read, write, edit files\n` +
        `• 💻 Run bash commands\n` +
        `• 🔍 Search codebases (grep, glob)\n` +
        `• 🌿 Git operations\n` +
        `• 📝 Write entire codebases\n` +
        `• 🐛 Debug and fix code\n` +
        `• 🤖 Multi-step agentic tasks\n\n` +
        `💬 *Send any message* — Claude Code will execute it\n` +
        `📸 *Send image* — Claude can read it\n` +
        `📄 *Send file* — Claude can process it\n` +
        `🎤 *Send voice* — auto-transcribed\n\n` +
        `*Commands:*\n` +
        `/status — system status\n` +
        `/pwd — show current dir\n` +
        `/cd <path> — change working dir`,
      "Markdown"
    );
    return;
  }

  if (text === "/status") {
    const proxyAlive = await isProxyAlive();
    let out = `📊 *System Status*\n\n`;
    out += `🤖 Claude Code: 2.1.x\n`;
    out += `🧠 Requested model: \`${MODEL}\`\n`;
    out += `🔌 Proxy: ${proxyAlive ? "✅ running" : "❌ down"}\n`;
    out += `🌐 Proxy URL: \`${PROXY_URL}\`\n`;
    out += `📁 Working dir: \`${currentWorkDir}\`\n`;
    out += `⏱️ Uptime: ${Math.round(process.uptime())}s\n\n`;
    out += `_Note: Z.AI proxy serves GLM. Check proxy log for actual backend model._`;
    await tgSendText(chatId, out, "Markdown");
    return;
  }

  if (text === "/model") {
    await tgSendText(
      chatId,
      `🧠 *Model Info*\n\n` +
        `*Requested model:* \`${MODEL}\`\n\n` +
        `This is the model name sent to Z.AI proxy.\n` +
        `Z.AI may serve a different actual model — check the proxy log:\n\n` +
        `\`tail -20 /tmp/anthropic_proxy.log\`\n\n` +
        `Look for lines like:\n` +
        `\`[PROXY] Response: requested=glm-5.2-plus actual=glm-4-plus ...\`\n\n` +
        `The \`actual\` field shows what Z.AI really served.`,
      "Markdown"
    );
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

  // Process media
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

  const beforeTs = Date.now();
  const result = await runClaudeCode(userPrompt, {
    cwd: currentWorkDir,
    timeoutSec: 240,
    imagePaths,
  });

  let responseText = result.text;
  if (result.duration > 5) {
    responseText = `${responseText}\n\n_⏱️ ${result.duration}s_`;
  }
  await tgSendText(chatId, responseText);

  // Send any newly created files
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
    if (!data.ok) { log(`TG API error: ${data.description}`); return; }
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
        try { await tgSendText(msg.chat.id, `❌ Error: ${err.message?.slice(0, 300)}`); } catch {}
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
  for (const dir of [WORK_DIR, DOWNLOAD_DIR, UPLOAD_DIR, STATE_DIR]) {
    mkdirSync(dir, { recursive: true });
  }
  try {
    const version = execSync("claude --version", { encoding: "utf-8" }).trim();
    log(`Claude Code version: ${version}`);
  } catch {
    log("ERROR: Claude Code not installed. Run: npm install -g @anthropic-ai/claude-code");
    process.exit(1);
  }
  if (!TG_TOKEN || !TG_USER_ID) {
    log("ERROR: Set TG_TOKEN and TG_USER_ID in .env");
    process.exit(1);
  }
  await ensureProxyRunning();

  log("════════════════════════════════════════════════");
  log("Claude Code Telegram Bridge — Starting");
  log(`User ID: ${TG_USER_ID}`);
  log(`Backend: GLM via Z.AI proxy`);
  log(`Proxy: ${PROXY_URL}`);
  log(`Working dir: ${currentWorkDir}`);
  log(`Poll duration: ${MAX_POLL}s`);
  log("════════════════════════════════════════════════");

  const startTime = Date.now();
  while (Date.now() - startTime < MAX_POLL * 1000) {
    if (!(await isProxyAlive())) {
      log("Proxy died — restarting...");
      await ensureProxyRunning();
    }
    await tgPollOnce();
  }
  log("Poll duration reached, exiting...");
}

main().catch((err) => { log(`FATAL: ${err.message}`); process.exit(1); });
