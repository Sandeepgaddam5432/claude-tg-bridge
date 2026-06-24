# 🤖 Claude Code Telegram Bridge

> **Real Claude Code CLI** on Telegram, via a local Anthropic→OpenAI translation proxy.
> Backend: GLM served by Z.AI internal proxy.

---

## 📑 Table of Contents

1. [What This Is](#-what-this-is)
2. [How It Works](#-how-it-works)
3. [Quick Start](#-quick-start)
4. [Architecture](#-architecture)
5. [Commands](#-commands)
6. [Configuration](#-configuration)
7. [24/7 Operation](#-247-operation)
8. [Example Tasks](#-example-tasks)
9. [How It Differs From v4](#-how-it-differs-from-v4)
10. [Troubleshooting](#-troubleshooting)
11. [Limitations](#-limitations)

---

## 🎯 What This Is

This is a **Telegram bot that runs the actual Claude Code CLI** (the official Anthropic
coding agent) on your server. Instead of using Anthropic's API, it routes requests
through a local proxy that translates Anthropic Messages API → OpenAI Chat Completions,
forwarding them to the **Z.AI internal proxy** which serves GLM.

### Why this matters

- ✅ **Real Claude Code** — the official `claude` binary with all its tools (Bash, Read, Write, Edit, Glob, Grep, etc.)
- ✅ **Single backend** — GLM via Z.AI proxy. No fake model picker, no fallback confusion.
- ✅ **24/7 operation** via supervisor + auto-restart
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
              │  Serves: GLM            │
              └────────────┬────────────┘
                           ↓
              ┌────────────┴────────────┐
              │  GLM Model              │
              │  (Zhipu AI)             │
              └─────────────────────────┘
```

### The Anthropic-to-OpenAI Translation

Claude Code speaks the **Anthropic Messages API** format. The Z.AI proxy speaks the
**OpenAI Chat Completions** format. The `anthropic_proxy.ts` server bridges them:

1. Receives Anthropic-format requests from Claude Code
2. Translates messages, tools, tool_choice to OpenAI format
3. Forwards to Z.AI proxy
4. Translates response back to Anthropic format
5. Returns to Claude Code

Works for: text generation, tool calling (Bash, Read, Write, Edit), streaming SSE, vision, system prompts.

---

## 🚀 Quick Start

### Prerequisites

1. **Bun** runtime
2. **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`
3. **Telegram Bot Token** from [@BotFather](https://t.me/BotFather)
4. **Your Telegram User ID** from [@userinfobot](https://t.me/userinfobot)
5. **Z.AI proxy config** at `/etc/.z-ai-config` or `~/.z-ai-config`

### Install

```bash
git clone https://github.com/Sandeepgaddam5432/claude-tg-bridge.git
cd claude-tg-bridge
bash install.sh
nano .env  # add TG_TOKEN and TG_USER_ID
```

### Run 24/7

```bash
bash start_247.sh
```

That's it! Send `/help` in Telegram.

---

## 🏗️ Architecture

### Components

| File | Purpose |
|------|---------|
| `anthropic_proxy.ts` | Local HTTP server translating Anthropic → OpenAI format. Port 8082. |
| `tg_bridge.ts` | Telegram bot that spawns Claude Code per message. Auto-starts proxy if down. |
| `supervisor.ts` | Bun supervisor — keeps bridge running in infinite loop. Restarts after each 270s poll cycle. |
| `start_247.sh` | One-command startup — starts proxy + supervisor |
| `install.sh` | One-click installer |

---

## 📋 Commands

### In Telegram

| Command | Description |
|---------|-------------|
| `/start`, `/help` | Show capabilities |
| `/status` | System status — proxy, working dir |
| `/pwd` | Show current working directory |
| `/cd <path>` | Change working directory |

### Natural Language

Just send any message — Claude Code will execute it. No model picker, no config needed.

### Multi-modal

- 📸 **Send image** → Claude reads it
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
```

---

## ⏰ 24/7 Operation

### One Command

```bash
bash start_247.sh
```

Starts 3 processes:
1. **Proxy** (`anthropic_proxy.ts`) — translation layer
2. **Supervisor** (`supervisor.ts`) — auto-restart loop
3. **Bridge** (`tg_bridge.ts`) — Telegram polling

The supervisor runs in an infinite loop:
- Each cycle: start bridge → bridge polls Telegram 270s → bridge exits → supervisor restarts it after 3s
- If proxy dies, supervisor auto-restarts it
- `setsid + exec` pattern ensures processes survive parent bash exit

### Stop

```bash
pkill -f 'supervisor.ts|tg_bridge.ts|anthropic_proxy.ts'
```

### Restart

```bash
bash start_247.sh
```

---

## 💡 Example Tasks

### Code Generation

```
You: "Build me a Python web scraper for Hacker News top stories"
Claude Code: [scaffolds project, writes scraper.py, installs deps, tests it]
Bot: [sends summary + attaches scraper.py]
```

### Codebase Refactoring

```
You: "Refactor /home/z/my-project/myapp for better performance"
Claude Code: [Glob finds files, Read examines, Edit applies changes, Bash runs tests]
Bot: [sends summary]
```

### Document Generation

```
You: "Generate a PDF report on AI trends in 2025"
Claude Code: [writes Python script with ReportLab, runs it, creates PDF]
Bot: [sends PDF]
```

### Debugging

```
You: "I'm getting this error: <paste error>. Fix it."
Claude Code: [Grep finds code, Read examines, Edit fixes, Bash verifies]
Bot: [sends explanation + fix]
```

---

## 🔄 How It Differs From v4

| Aspect | Old v4 (proxy-tg_setup) | New (claude-tg-bridge) |
|--------|------------------------|------------------------|
| Agent engine | Custom TypeScript agent loop | **Real Claude Code CLI** |
| Tools | 29 custom tools | Claude Code's built-in tools (Bash, Read, Write, Edit, Glob, Grep) |
| Model picker | 23 fake models | **None — single backend** |
| Fallback | Chain of models | **None — direct** |
| Anthropic API | Not used | Translated via local proxy |

---

## 🔧 Troubleshooting

### Bot not responding

1. Check `.env` has `TG_TOKEN` and `TG_USER_ID`
2. Check processes: `ps aux | grep -E "supervisor|tg_bridge|anthropic_proxy"`
3. Check logs: `tail -50 /tmp/claude_tg_bot.log`
4. Test proxy: `curl http://127.0.0.1:8082/health`

### "Conflict: terminated by other getUpdates request"

Another bot instance is running. Kill all and restart:
```bash
pkill -f 'supervisor.ts|tg_bridge.ts|anthropic_proxy.ts'
bash start_247.sh
```

### Proxy crashes

```bash
curl http://127.0.0.1:8082/health
# If down, supervisor will auto-restart it. Or manually:
bash start_247.sh
```

### Z.AI rate limits (429)

- Wait a few minutes between heavy requests
- Check proxy log: `tail -f /tmp/anthropic_proxy.log`

---

## ⚠️ Limitations

1. **Stateless conversations** — Each Telegram message is a fresh Claude Code invocation. Use `/cd` to maintain working directory context.

2. **270-second timeout per message** — Claude Code is killed after 240s.

3. **Owner-only** — Bot only responds to `TG_USER_ID`. No multi-user support.

4. **Z.AI proxy required** — Needs `/etc/.z-ai-config` with valid Z.AI credentials.

5. **Single backend model** — Z.AI proxy serves GLM. No model switching.

6. **No MCP servers** — Only Claude Code's built-in tools.

---

## 📜 License

Personal use. Built by Sandeep Gaddam.

## 🙏 Acknowledgments

- **Anthropic** for Claude Code CLI
- **Zhipu AI / Z.AI** for the GLM model and proxy access
- **Unsloth** for the [Claude Code + local LLMs guide](https://unsloth.ai/docs/basics/claude-code)
- **Bun** for the fast JavaScript runtime

---

**Star ⭐ this repo if it helps you!**
