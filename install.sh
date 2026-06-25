#!/bin/bash
# ═══════════════════════════════════════════════════════
#  install.sh — One-click setup for Claude Code Telegram Bridge
# ═══════════════════════════════════════════════════════

set -e
BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="${WORK_DIR:-/home/z/my-project}"

echo ""
echo "════════════════════════════════════════════════"
echo "  Claude Code Telegram Bridge — Installer"
echo "  Real Claude Code + GLM-5.2-Plus via Z.AI"
echo "════════════════════════════════════════════════"
echo "  Bot dir:  $BOT_DIR"
echo "  Work dir: $WORK_DIR"
echo ""

# ─── 1. Install Bun ─────────────────────────────────────
if ! command -v bun &>/dev/null; then
  echo "📦 Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi
echo "✅ Bun: $(bun --version)"

# ─── 2. Install Claude Code CLI ─────────────────────────
if ! command -v claude &>/dev/null; then
  echo "📦 Installing Claude Code CLI..."
  npm install -g @anthropic-ai/claude-code
fi
echo "✅ Claude Code: $(claude --version)"

# ─── 3. Install deps ────────────────────────────────────
echo "📦 Installing project deps..."
cd "$BOT_DIR"
bun install

# ─── 4. Setup work directories ──────────────────────────
mkdir -p "$WORK_DIR"/{download,upload,agent_state}

# ─── 5. Create .env ─────────────────────────────────────
if [ ! -f "$BOT_DIR/.env" ]; then
  cat > "$BOT_DIR/.env" <<'EOF'
# ═══ Claude Code Telegram Bridge — Environment ═══

# Telegram Bot Token (from @BotFather)
TG_TOKEN=

# Your Telegram User ID (from @userinfobot)
TG_USER_ID=

# Working directory (default: /home/z/my-project)
WORK_DIR=/home/z/my-project

# Anthropic proxy port (default: 8082)
PROXY_PORT=8082
EOF
  echo "✅ Created .env — EDIT IT to add your TG_TOKEN and TG_USER_ID"
  echo "   nano $BOT_DIR/.env"
else
  echo "✅ .env already exists"
fi

# ─── 6. Check Z.AI config ───────────────────────────────
if [ -f "/etc/.z-ai-config" ] || [ -f "$HOME/.z-ai-config" ]; then
  echo "✅ Z.AI config found"
else
  echo "⚠️  Z.AI config not found. The proxy needs /etc/.z-ai-config or ~/.z-ai-config"
  echo "   This is auto-created when running inside Z.AI environment."
fi

# ─── 7. Done ────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════"
echo "  ✅ Installation Complete!"
echo "════════════════════════════════════════════════"
echo ""
echo "  Next steps:"
echo "  1. Edit .env:  nano $BOT_DIR/.env"
echo "  2. Start bot:  bash $BOT_DIR/start.sh"
echo "  3. For 24/7:   bash $BOT_DIR/setup_cron.sh"
echo ""
echo "  Test in Telegram:"
echo "  • Send /help     — see capabilities"
echo "  • Send /models   — list GLM models"
echo "  • Send any task  — Claude Code executes it"
echo ""
