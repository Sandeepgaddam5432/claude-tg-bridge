#!/bin/bash
# Test claude code with proxy
export ANTHROPIC_BASE_URL=http://127.0.0.1:8082
export ANTHROPIC_API_KEY=dummy
export ANTHROPIC_MODEL=glm-5.2-plus
export CLAUDE_CODE_ATTRIBUTION_HEADER=0
export CLAUDE_CODE_ENABLE_TELEMETRY=0
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

cd /tmp
echo "Testing claude code at $(date)" > /tmp/claude_test.log
echo "ANTHROPIC_BASE_URL=$ANTHROPIC_BASE_URL" >> /tmp/claude_test.log
echo "Running claude..." >> /tmp/claude_test.log

claude --print --bare --dangerously-skip-permissions "Say OK only" >> /tmp/claude_test.log 2>&1
echo "EXIT: $?" >> /tmp/claude_test.log
echo "Done at $(date)" >> /tmp/claude_test.log
