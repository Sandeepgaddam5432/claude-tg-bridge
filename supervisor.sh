#!/bin/bash
# ═══════════════════════════════════════════════════════
#  supervisor.sh — Keeps the bot running 24/7
#  Restarts the bridge after each 270s poll cycle
#  Also ensures the proxy stays alive
# ═══════════════════════════════════════════════════════

BOT_DIR="/home/z/my-project/claude-tg-bridge"
WORK_DIR="/home/z/my-project"
LOG_FILE="/tmp/claude_tg_supervisor.log"
PROXY_LOG="/tmp/anthropic_proxy.log"
BRIDGE_LOG="/tmp/claude_tg_bot.log"

# Load env
cd "$BOT_DIR"
set -a
. ./.env
set +a
export WORK_DIR="$WORK_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
  echo "[$(date '+%H:%M:%S')] $1"
}

log "════════════════════════════════════════════════"
log "Claude Code TG Bridge — Supervisor Starting"
log "Bot dir: $BOT_DIR"
log "════════════════════════════════════════════════"

while true; do
  # Step 1: Ensure proxy is alive
  if ! curl -s http://127.0.0.1:${PROXY_PORT:-8082}/health > /dev/null 2>&1; then
    log "▶ Starting proxy..."
    nohup setsid bun run "$BOT_DIR/anthropic_proxy.ts" > "$PROXY_LOG" 2>&1 < /dev/null &
    PROXY_PID=$!
    disown
    log "  Proxy PID: $PROXY_PID"
    
    # Wait for proxy to be ready
    for i in {1..15}; do
      sleep 1
      if curl -s http://127.0.0.1:${PROXY_PORT:-8082}/health > /dev/null 2>&1; then
        log "  ✅ Proxy ready"
        break
      fi
      if [ $i -eq 15 ]; then
        log "  ❌ Proxy failed to start. Will retry in 30s."
        sleep 30
        continue 2
      fi
    done
  fi

  # Step 2: Run bridge (will exit after 270s poll cycle)
  log "▶ Starting bridge cycle..."
  bun run "$BOT_DIR/tg_bridge.ts" >> "$BRIDGE_LOG" 2>&1
  EXIT_CODE=$?
  log "  Bridge exited (code $EXIT_CODE). Restarting in 3s..."
  
  # Brief pause before next cycle
  sleep 3
done
