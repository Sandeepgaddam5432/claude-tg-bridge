#!/bin/bash
# ═══════════════════════════════════════════════════════
#  start.sh — Start Claude Code Telegram Bridge
#  Spawns proxy + bridge in background
# ═══════════════════════════════════════════════════════

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="${WORK_DIR:-/home/z/my-project}"
LOG_FILE="/tmp/claude_tg_bot.log"
PROXY_LOG="/tmp/anthropic_proxy.log"
PID_FILE="/tmp/claude_tg_bot.pid"
PROXY_PID_FILE="/tmp/anthropic_proxy.pid"

# Load env
if [ -f "$BOT_DIR/.env" ]; then
  set -a
  . "$BOT_DIR/.env"
  set +a
fi

echo ""
echo "════════════════════════════════════════════════"
echo "  Claude Code Telegram Bridge — Starting"
echo "════════════════════════════════════════════════"
echo "  Bot dir:   $BOT_DIR"
echo "  Work dir:  $WORK_DIR"
echo "  Bot log:   $LOG_FILE"
echo "  Proxy log: $PROXY_LOG"
echo ""

# Check bun
if ! command -v bun &>/dev/null; then
  echo "❌ bun not found. Run install.sh first."
  exit 1
fi

# Check claude
if ! command -v claude &>/dev/null; then
  echo "❌ claude not found. Run install.sh first."
  exit 1
fi

# Kill existing
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "🛑 Stopping existing bot (PID: $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
  fi
  rm -f "$PID_FILE"
fi

if [ -f "$PROXY_PID_FILE" ]; then
  OLD_PROXY_PID=$(cat "$PROXY_PID_FILE")
  if kill -0 "$OLD_PROXY_PID" 2>/dev/null; then
    echo "🛑 Stopping existing proxy (PID: $OLD_PROXY_PID)..."
    kill "$OLD_PROXY_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PROXY_PID_FILE"
fi

# ─── Start proxy ────────────────────────────────────────
echo "▶ Starting Anthropic proxy..."
nohup setsid bun run "$BOT_DIR/anthropic_proxy.ts" > "$PROXY_LOG" 2>&1 < /dev/null &
PROXY_PID=$!
echo $PROXY_PID > "$PROXY_PID_FILE"
disown
echo "  PID: $PROXY_PID"

# Wait for proxy
for i in {1..10}; do
  sleep 1
  if curl -s http://127.0.0.1:${PROXY_PORT:-8082}/health > /dev/null 2>&1; then
    echo "✅ Proxy is running"
    break
  fi
  if [ $i -eq 10 ]; then
    echo "❌ Proxy failed to start. Check $PROXY_LOG"
    exit 1
  fi
done

# ─── Start bridge ───────────────────────────────────────
echo "▶ Starting Telegram bridge..."
nohup setsid bun run "$BOT_DIR/tg_bridge.ts" > "$LOG_FILE" 2>&1 < /dev/null &
BRIDGE_PID=$!
echo $BRIDGE_PID > "$PID_FILE"
disown
echo "  PID: $BRIDGE_PID"

sleep 3
if kill -0 "$BRIDGE_PID" 2>/dev/null; then
  echo ""
  echo "✅ Bridge is running"
  echo ""
  echo "  Logs:       tail -f $LOG_FILE"
  echo "  Proxy log:  tail -f $PROXY_LOG"
  echo "  Stop:       kill \$(cat $PID_FILE) \$(cat $PROXY_PID_FILE)"
  echo ""
  echo "  Send /help in Telegram to see capabilities."
else
  echo "❌ Bridge failed to start. Check $LOG_FILE"
  tail -20 "$LOG_FILE"
  exit 1
fi
