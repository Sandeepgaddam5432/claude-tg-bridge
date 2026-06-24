# 🤖 Claude Code Telegram Bridge

> **Real Claude Code CLI** running on Telegram, powered by **GLM-5.2-Plus** via the Z.AI proxy.
> No fake "Claude-Code-level" imitation — this is the actual `claude` binary from Anthropic,
> bridged to use GLM-5.2-Plus as the model backend.

---

## 📑 Table of Contents

1. [What This Is](#-what-this-is)
2. [How It Works](#-how-it-works)
3. [Quick Start](#-quick-start)
4. [Architecture](#-architecture)
5. [Available Models (23)](#-available-models-23)
6. [Commands](#-commands)
7. [Configuration](#-configuration)
8. [File Structure](#-file-structure)
9. [24/7 Operation](#-247-operation)
10. [Example Tasks](#-example-tasks)
11. [How It Differs From v4](#-how-it-differs-from-v4)
12. [Troubleshooting](#-troubleshooting)
13. [Limitations](#-limitations)

---

## 🎯 What This Is

This is a **Telegram bot that runs the actual Claude Code CLI** (the official Anthropic
coding agent) on your server. Instead of using Anthropic's API (which requires a Claude
subscription), it uses **GLM-5.2-Plus** as the model backend via the Z.AI proxy.

### Why this matters

- ✅ **Real Claude Code** — the official `claude` binary with all its tools (Bash, Read, Write, Edit, Glob, Grep, etc.)
- ✅ **GLM-5.2-Plus** — premium flagship model from Zhipu AI, accessed via Z.AI proxy
- ✅ **No fallback** — user choice is respected. If you select a model, only that model is used
- ✅ **24/7 operation** via cron
- ✅ **Multi-modal** — text, images, voice (with transcription), files
- ✅ **Telegram-native** — send tasks from your phone, get responses back

---

## 🔧 How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    You (Telegram)                            │
│  Send message: "Build me a Python web scraper"              │
└──────────────────────────┬──────────────────────────────────┘
                           ↓
              ┌────────────┴────────────┐
              │  tg_bridge.ts (Bot)     │
              │  • Polls TG every 25s   │
              │  • Handles commands     │
              │  • Spawns Claude Code   │
              └────────────┬────────────┘
                           ↓
              ┌────────────┴────────────┐
              │  Claude Code CLI 2.1.x  │
              │  • Bash, Read, Write    │
              │  • Edit, Glob, Grep     │
              │  • Multi-step agent     │
              │  --print --bare mode    │
              └────────────┬────────────┘
                           ↓
              ┌────────────┴────────────┐
              │  anthropic_proxy.ts     │
              │  (local HTTP server)    │
              │  Translates:            │
              │  Anthropic /v1/messages │
              │      ↓                  │
              │  OpenAI /v1/chat/comp   │
              └────────────┬────────────┘
                           ↓
              ┌────────────┴────────────┐
              │  Z.AI Internal Proxy    │
              │  internal-api.z.ai/v1   │
              │  Backend: GLM-5.2-Plus  │
              └────────────┬────────────┘
                           ↓
              ┌────────────┴────────────┐
              │  GLM-5.2-Plus Model     │
              │  (Zhipu AI flagship)    │
              └─────────────────────────┘
```

### The Anthropic-to-OpenAI Translation

Claude Code speaks the **Anthropic Messages API** format (used by Claude models). The Z.AI
proxy speaks the **OpenAI Chat Completions** format (used by GLM models).

The `anthropic_proxy.ts` server sits in between:
1. Receives Anthropic-format requests from Claude Code
2. Translates messages, tools, tool_choice to OpenAI format
3. Forwards to Z.AI proxy
4. Translates the response back to Anthropic format
5. Returns to Claude Code

This works for:
- ✅ Text generation
- ✅ Tool calling (Bash, Read, Write, Edit, etc.)
- ✅ Streaming (SSE events)
- ✅ Vision (image input)
- ✅ System prompts

---

## 🚀 Quick Start

### Prerequisites

1. **Bun** runtime
2. **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`
3. **Telegram Bot Token** from [@BotFather](https://t.me/BotFather)
4. **Your Telegram User ID** from [@userinfobot](https://t.me/userinfobot)
5. **Z.AI proxy config** at `/etc/.z-ai-config` or `~/.z-ai-config`

### One-Click Install

```bash
git clone <your-new-repo-url> claude-tg-bridge
cd claude-tg-bridge
bash install.sh
```

The installer will:
1. Install Bun (if missing)
2. Install Claude Code CLI (if missing)
3. Install npm dependencies
4. Create `.env` template
5. Check Z.AI config

### Configure

```bash
nano .env
```

Add your tokens:
```bash
TG_TOKEN=your_bot_token_from_botfather
TG_USER_ID=your_telegram_user_id
WORK_DIR=/home/z/my-project
PROXY_PORT=8082
```

### Run

**Persistent mode:**
```bash
bash start.sh
```

**24/7 Cron mode:**
```bash
bash setup_cron.sh
```

That's it! Send `/help` in Telegram.

---

## 🏗️ Architecture

### Components

| File | Purpose |
|------|---------|
| `anthropic_proxy.ts` | Local HTTP server that translates Anthropic → OpenAI format. Listens on port 8082. |
| `tg_bridge.ts` | Telegram bot that bridges messages to Claude Code CLI. Auto-starts proxy if down. |
| `start.sh` | Starts both proxy + bridge in background (nohup + setsid) |
| `setup_cron.sh` | Sets up cron for 24/7 operation (every 5 min, 270s poll) |
| `install.sh` | One-click installer |

### Process Flow

```
1. start.sh launches:
   - anthropic_proxy.ts (PID saved to /tmp/anthropic_proxy.pid)
   - tg_bridge.ts (PID saved to /tmp/claude_tg_bot.pid)

2. tg_bridge.ts runs:
   - Checks Claude Code installed
   - Checks proxy alive (restarts if dead)
   - Polls Telegram every 25 seconds
   - On message:
     a. If command (/help, /models, etc.) — handle directly
     b. If task — spawn `claude --print --bare` with prompt
     c. Stream output as Telegram message
     d. Send any files Claude created

3. anthropic_proxy.ts:
   - Listens on port 8082
   - Receives Anthropic /v1/messages from Claude Code
   - Translates to OpenAI format
   - Forwards to Z.AI internal API
   - Returns translated response
```

### Why `--print --bare`?

Claude Code has two modes:
- **Interactive** — full TUI with conversation history
- **Print mode** (`--print` or `-p`) — single-shot execution, prints output and exits

We use `--print --bare` for:
- Non-interactive execution (no TUI)
- Clean stdout (no decorations)
- Each Telegram message = one Claude Code invocation
- No conversation state between messages (stateless)

The `--dangerously-skip-permissions` flag lets Claude Code run shell commands without
prompting for approval (required for non-interactive use).

---

## 🧠 Available Models (23)

All models accessed via Z.AI proxy. **Default: `glm-5.2-plus`. No fallback.**

### How to switch

```
/models              — list all 23 models
/model glm-5.2-flash — switch (persists across sessions)
```

### GLM-5 Series (Latest Flagship)

| Model | Description | Context |
|-------|-------------|---------|
| ⭐ `glm-5.2-plus` | **DEFAULT** — Premium flagship | 128K |
| 🚀 `glm-5.2` | Fast flagship | 128K |
| `glm-5.2-air` | Lighter 5.2 | 128K |
| ⚡ `glm-5.2-flash` | Free tier 5.2 | 128K |
| `glm-5.2x` | Extreme 5.2 — long outputs | 128K |
| 👁️ `glm-5.2v` | Vision 5.2 | 128K |
| `glm-5` | Base 5 series | 128K |
| `glm-5-plus` | Premium 5 | 128K |
| `glm-5-air` | Light 5 | 128K |
| ⚡ `glm-5-flash` | Free 5 | 128K |
| 👁️ `glm-5v` | Vision 5 | 128K |
| 👁️ `glm-5v-plus` | Premium Vision 5 | 8K |

### GLM-4 Series

| Model | Description | Context |
|-------|-------------|---------|
| `glm-4.6` | Previous flagship | 128K |
| `glm-4.5` | Strong 4.5 | 128K |
| `glm-4.5-air` | Fast 4.5 | 128K |
| `glm-4.5x` | Long-output 4.5 | 128K |
| 👁️ `glm-4.5v` | Vision 4.5 | 128K |
| 📚 `glm-4-long` | 1M token context | 1M |
| 👁️ `glm-4v-plus` | Best vision in 4 series | 8K |
| ⚡ `glm-4-flash` | Free fast 4 | 128K |

### Reasoning Models

| Model | Description | Context |
|-------|-------------|---------|
| 🧠 `glm-zero` | Reasoning (o1-style) | 128K |
| 🧠 `glm-zero-preview` | Reasoning preview | 128K |
| 🧠 `glm-zero-1` | Reasoning v1 | 128K |

### No Fallback Policy

**User choice is respected absolutely.** If you select `glm-zero` and it's rate-limited,
the bot will return an error rather than silently switching to another model. This is by
design — you should know exactly which model is processing your requests.

---

## 📋 Commands

### In Telegram

| Command | Description |
|---------|-------------|
| `/start`, `/help` | Show capabilities |
| `/models` | List all 23 GLM models |
| `/model <name>` | Switch model (persists in `agent_state/current_model.json`) |
| `/status` | System status — model, proxy, working dir |
| `/pwd` | Show current working directory |
| `/cd <path>` | Change working directory |

### Natural Language

Just send any message — Claude Code will execute it:

- "Build me a Python script that scrapes Hacker News"
- "Refactor my codebase for better performance"
- "Generate a PDF report on AI trends"
- "Debug this error: <paste error>"
- "Write tests for this function: <paste code>"

### Multi-modal

- 📸 **Send image** → Claude reads it (with `glm-*-v` models)
- 🎤 **Send voice** → Auto-transcribed via Z.AI ASR
- 📄 **Send file** → Claude reads & processes

---

## ⚙️ Configuration

### `.env` File

```bash
# Telegram (required)
TG_TOKEN=your_bot_token
TG_USER_ID=your_user_id

# Working directory (default: /home/z/my-project)
WORK_DIR=/home/z/my-project

# Anthropic proxy port (default: 8082)
PROXY_PORT=8082

# Override default model (default: glm-5.2-plus, no fallback)
# GLM_MODEL=glm-5.2-flash
```

### Z.AI Config (Auto-generated)

The Z.AI SDK auto-creates `/etc/.z-ai-config` or `~/.z-ai-config`:

```json
{
  "baseUrl": "https://internal-api.z.ai/v1",
  "apiKey": "Z.ai",
  "chatId": "chat-...",
  "token": "eyJ...",
  "userId": "..."
}
```

The proxy reads this file at startup. **Do not modify** — it's auto-generated.

### Claude Code Settings

Claude Code is launched with these flags:
- `--print --bare` — non-interactive single-shot mode
- `--dangerously-skip-permissions` — no permission prompts
- `--model <user-choice>` — always uses user-selected model
- `--settings '{"env":{...}}'` — disable attribution/telemetry headers (improves performance)

Environment variables set:
- `ANTHROPIC_BASE_URL=http://127.0.0.1:8082` — point to our proxy
- `ANTHROPIC_API_KEY=dummy` — Claude Code requires this to be set
- `CLAUDE_CODE_ATTRIBUTION_HEADER=0` — disables KV cache invalidating header
- `CLAUDE_CODE_ENABLE_TELEMETRY=0` — no telemetry
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` — no background requests

---

## 📁 File Structure

```
claude-tg-bridge/
├── anthropic_proxy.ts        # Anthropic → OpenAI translation proxy
├── tg_bridge.ts              # Telegram bot → Claude Code bridge
├── package.json              # Bun dependencies
├── tsconfig.json             # TypeScript config
├── install.sh                # One-click installer
├── start.sh                  # Start both proxy + bridge
├── setup_cron.sh             # 24/7 cron setup
├── .env.example              # Environment template
├── README.md                 # This file
└── (generated)
    ├── .env                  # Your configuration
    └── node_modules/         # Dependencies

# Runtime (in WORK_DIR, default /home/z/my-project)
/home/z/my-project/
├── download/                 # Files Claude creates
├── upload/                   # Files you send via Telegram
├── agent_state/
│   ├── tg_offset.json        # Telegram poll offset
│   └── current_model.json    # User's model choice
├── claude_bot.log            # Bridge logs
└── (whatever Claude creates in the working dir)
```

---

## ⏰ 24/7 Operation

### Persistent Mode (Recommended for VPS)

```bash
bash start.sh
```

Launches both proxy and bridge in background using `nohup + setsid`. Process IDs saved to:
- `/tmp/anthropic_proxy.pid`
- `/tmp/claude_tg_bot.pid`

Stop:
```bash
kill $(cat /tmp/claude_tg_bot.pid) $(cat /tmp/anthropic_proxy.pid)
```

Logs:
```bash
tail -f /tmp/claude_tg_bot.log     # bridge log
tail -f /tmp/anthropic_proxy.log   # proxy log
```

### Cron Mode (Recommended for Sandboxes)

```bash
bash setup_cron.sh
```

Adds cron entry:
```
*/5 * * * * cd /path/to/bot && . .env; bun run tg_bridge.ts >> claude_bot.log 2>&1
```

Runs every 5 minutes for 270 seconds. Near-zero gap. The proxy is auto-started
by the bridge if it's not running.

---

## 💡 Example Tasks

### Code Generation

```
You: "Build me a Python web scraper for Hacker News top stories"

Claude Code:
  [Uses Bash to scaffold project]
  [Uses Write to create scraper.py]
  [Uses Bash to install requests + beautifulsoup4]
  [Uses Bash to test the scraper]
  [Returns summary + file path]

Bot: [Sends summary, then attaches scraper.py]
```

### Codebase Refactoring

```
You: "Refactor /home/z/my-project/myapp for better performance"

Claude Code:
  [Uses Glob to find all .py files]
  [Uses Read to examine each file]
  [Uses Edit to apply optimizations]
  [Uses Bash to run tests]
  [Returns summary of changes]

Bot: [Sends summary]
```

### Document Generation

```
You: "Generate a PDF report on AI trends in 2025"

Claude Code:
  [Uses Bash to write Python script with ReportLab]
  [Uses Bash to run script]
  [Creates PDF in /home/z/my-project/download/]
  [Returns summary]

Bot: [Sends summary, then attaches PDF]
```

### Web App Development

```
You: "Build me a Next.js dashboard for tracking crypto prices"

Claude Code:
  [Uses Bash to scaffold Next.js app]
  [Uses Write to create components]
  [Uses Bash to install deps]
  [Uses Bash to start dev server]
  [Returns preview URL]

Bot: [Sends summary with preview URL]
```

### Debugging

```
You: "I'm getting this error: [paste error]. Fix it."

Claude Code:
  [Uses Grep to find relevant code]
  [Uses Read to examine the code]
  [Identifies bug]
  [Uses Edit to fix]
  [Uses Bash to verify fix]
  [Returns summary]

Bot: [Sends explanation + fix]
```

### Image Analysis (with vision model)

```
/model glm-5.2v   # switch to vision model

You: [Send photo of code on whiteboard]
You: "Transcribe this code and run it"

Claude Code:
  [Uses Read to view the image]
  [Transcribes the code]
  [Uses Write to create the .py file]
  [Uses Bash to run it]
  [Returns output]

Bot: [Sends transcription + output]
```

---

## 🔄 How It Differs From v4

The previous `proxy-tg_setup` repo (v4) claimed "Claude-Code-level capabilities" but
was actually a custom agent loop built from scratch. This new project:

| Aspect | Old v4 (proxy-tg_setup) | New (claude-tg-bridge) |
|--------|------------------------|------------------------|
| Agent engine | Custom TypeScript agent loop | **Real Claude Code CLI** |
| Tools | 29 custom tools | Claude Code's built-in tools (Bash, Read, Write, Edit, Glob, Grep, etc.) |
| Default model | glm-5.2-plus (with fallback) | **glm-5.2-plus (NO fallback)** |
| User choice | Could be overridden by fallback | **Always respected** |
| Anthropic API | Not used | Translated via local proxy |
| Skills system | 65+ custom skills | Claude Code's native skills |
| Code quality | Custom implementation | Anthropic's production code |
| Maintenance | Custom bugs | Claude Code's well-tested CLI |

**Key improvement:** Instead of trying to **imitate** Claude Code, this project **uses**
Claude Code. The Anthropic-to-OpenAI proxy makes Claude Code think it's talking to
Anthropic's API, but actually GLM-5.2-Plus is doing the work.

---

## 🔧 Troubleshooting

### Bot not responding

1. Check `.env` has `TG_TOKEN` and `TG_USER_ID`
2. Check both processes are running:
   ```bash
   ps -p $(cat /tmp/claude_tg_bot.pid)
   ps -p $(cat /tmp/anthropic_proxy.pid)
   ```
3. Check logs:
   ```bash
   tail -50 /tmp/claude_tg_bot.log
   tail -50 /tmp/anthropic_proxy.log
   ```
4. Test proxy health:
   ```bash
   curl http://127.0.0.1:8082/health
   ```

### "调用失败: context deadline exceeded"

This means the bash command timed out. Likely causes:
- Claude Code is taking too long (try a simpler prompt)
- Proxy is down (restart with `bash start.sh`)
- Z.AI API is rate-limited (wait and retry)

### Proxy crashes

```bash
# Check Z.AI config
cat /etc/.z-ai-config | python3 -m json.tool

# Restart proxy
kill $(cat /tmp/anthropic_proxy.pid)
bun run anthropic_proxy.ts
```

### Claude Code can't be found

```bash
npm install -g @anthropic-ai/claude-code
which claude
```

### Z.AI rate limits (429 errors)

- Wait a few minutes between heavy requests
- Try a different model: `/model glm-5.2-flash` (free tier)
- Use the proxy log to see error details: `tail -f /tmp/anthropic_proxy.log`

### Voice messages fail to transcribe

The bridge uses Z.AI's ASR for voice transcription. If it fails:
- Check Z.AI config is valid
- Try sending text instead

### Files not being sent back

The bridge looks for newly created files in `/home/z/my-project/download/`.
If Claude creates files elsewhere:
- Use `/cd <path>` to change working dir before sending task
- Or ask Claude explicitly: "Save the file to /home/z/my-project/download/"

---

## ⚠️ Limitations

1. **Stateless conversations** — Each Telegram message is a fresh Claude Code invocation.
   No memory of previous messages. Use `/cd` to maintain working directory context.

2. **270-second timeout per message** — Claude Code is killed after 240s. For longer tasks,
   break them into smaller steps.

3. **No streaming to Telegram** — Claude Code's output is collected and sent as one message.
   (Telegram doesn't support streaming anyway.)

4. **No fallback** — If the selected model is unavailable, the request fails. This is by design.

5. **Owner-only** — Bot only responds to `TG_USER_ID`. No multi-user support.

6. **Z.AI proxy required** — The proxy needs `/etc/.z-ai-config` with valid Z.AI credentials.
   This is auto-generated inside Z.AI environments.

7. **Claude Code version pinned** — Behavior depends on Claude Code CLI version (tested with 2.1.x).

8. **No MCP servers** — Only Claude Code's built-in tools are available. MCP servers can be
   added via `--mcp-config` flag if needed.

---

## 📜 License

Personal use. Built by Sandeep Gaddam.

## 🙏 Acknowledgments

- **Anthropic** for Claude Code CLI
- **Zhipu AI / Z.AI** for the GLM model series and proxy access
- **Unsloth** for the [Claude Code + local LLMs guide](https://unsloth.ai/docs/basics/claude-code)
  that inspired this project
- **Bun** for the fast JavaScript runtime

---

**Star ⭐ this repo if it helps you!**
