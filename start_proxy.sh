#!/bin/bash
# Start the Anthropic proxy in a fully detached way
cd /home/z/my-project/claude-tg-bridge
nohup setsid bun run anthropic_proxy.ts > /tmp/proxy.log 2>&1 < /dev/null &
disown
PROXY_PID=$!
echo "Proxy PID: $PROXY_PID"
sleep 3
if kill -0 $PROXY_PID 2>/dev/null; then
  echo "✅ Proxy is running"
else
  echo "❌ Proxy died"
  cat /tmp/proxy.log
  exit 1
fi

# Save PID for later
echo $PROXY_PID > /tmp/proxy.pid
echo "PID saved to /tmp/proxy.pid"
