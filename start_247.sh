#!/bin/bash
# ═══════════════════════════════════════════════════════
#  start_247.sh — One command to start 24/7 bot
#  Starts proxy + supervisor (which manages bridge)
# ═══════════════════════════════════════════════════════

BOT_DIR="/home/z/my-project/claude-tg-bridge"
cd "$BOT_DIR"

# Load env
set -a; . ./.env; set +a

echo "════════════════════════════════════════════════"
echo "  Claude Code TG Bridge — 24/7 Start"
echo "════════════════════════════════════════════════"

# Step 1: Start proxy if not running
if ! curl -s http://127.0.0.1:${PROXY_PORT:-8082}/health > /dev/null 2>&1; then
  echo "▶ Starting proxy..."
  setsid bash -c "exec bun run $BOT_DIR/anthropic_proxy.ts > /tmp/anthropic_proxy.log 2>&1" < /dev/null > /dev/null 2>&1 &
  disown
  for i in {1..10}; do
    sleep 1
    if curl -s http://127.0.0.1:${PROXY_PORT:-8082}/health > /dev/null 2>&1; then
      echo "✅ Proxy ready"
      break
    fi
  done
else
  echo "✅ Proxy already running"
fi

# Step 2: Kill any existing supervisor
pkill -f "supervisor.ts" 2>/dev/null
sleep 1

# Step 3: Start supervisor (uses exec to survive parent exit)
echo "▶ Starting supervisor..."
setsid bash -c "exec bun run $BOT_DIR/supervisor.ts > /tmp/claude_tg_supervisor.log 2>&1" < /dev/null > /dev/null 2>&1 &
disown

sleep 5
echo ""
echo "=== Status ==="
ps aux | grep -E "supervisor.ts|tg_bridge|anthropic_proxy" | grep -v grep | awk '{print "  PID:" $2, $11, $12, $13}'
echo ""
echo "✅ Bot is running 24/7"
echo ""
echo "  Logs:"
echo "    Supervisor: tail -f /tmp/claude_tg_supervisor.log"
echo "    Bridge:     tail -f /tmp/claude_tg_bot.log"
echo "    Proxy:      tail -f /tmp/anthropic_proxy.log"
echo ""
echo "  Stop: pkill -f 'supervisor.ts|tg_bridge.ts|anthropic_proxy.ts'"
echo "  Restart: bash $BOT_DIR/start_247.sh"
