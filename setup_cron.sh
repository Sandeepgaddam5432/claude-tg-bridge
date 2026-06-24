#!/bin/bash
# ═══════════════════════════════════════════════════════
#  setup_cron.sh — 24/7 Cron Setup
#  Runs bridge every 5 min — 270s poll — near-zero gaps
# ═══════════════════════════════════════════════════════

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="${WORK_DIR:-/home/z/my-project}"
BUN_BIN="${HOME}/.bun/bin/bun"
[ ! -f "$BUN_BIN" ] && BUN_BIN=$(which bun 2>/dev/null)

if [ -z "$BUN_BIN" ]; then
  echo "❌ bun not found. Run install.sh first."
  exit 1
fi

CRON_ENTRY="*/5 * * * * cd '$BOT_DIR' && . '$BOT_DIR/.env' 2>/dev/null; WORK_DIR='$WORK_DIR' $BUN_BIN run tg_bridge.ts >> '$BOT_DIR/claude_bot.log' 2>&1"

echo "════════════════════════════════════════════════"
echo "  24/7 Cron Setup — Claude Code TG Bridge"
echo "════════════════════════════════════════════════"
echo "  bun:     $BUN_BIN"
echo "  dir:     $BOT_DIR"
echo "  Schedule: every 5 minutes, 270s poll"
echo ""

# Remove existing
EXISTING=$(crontab -l 2>/dev/null | grep "tg_bridge.ts")
if [ -n "$EXISTING" ]; then
  echo "ℹ️  Existing cron entries, removing..."
  crontab -l 2>/dev/null | grep -v "tg_bridge.ts" | crontab -
fi

# Add new
(crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -

echo "✅ Cron configured! Entry:"
echo "  $CRON_ENTRY"
echo ""
echo "  Verify:  crontab -l"
echo "  Remove:  crontab -l | grep -v tg_bridge.ts | crontab -"
echo "  Logs:    tail -f $BOT_DIR/claude_bot.log"
echo ""
echo "════════════════════════════════════════════════"
