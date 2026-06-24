#!/bin/bash
# Test claude code with file operations
export ANTHROPIC_BASE_URL=http://127.0.0.1:8082
export ANTHROPIC_API_KEY=dummy
export ANTHROPIC_MODEL=glm-5.2-plus
export CLAUDE_CODE_ATTRIBUTION_HEADER=0
export CLAUDE_CODE_ENABLE_TELEMETRY=0
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

mkdir -p /tmp/claude_test_workspace
cd /tmp/claude_test_workspace

echo "=== TEST 1: Simple chat ===" > /tmp/claude_test2.log
claude --print --bare --dangerously-skip-permissions \
  "What is 17 * 23? Just give me the answer." >> /tmp/claude_test2.log 2>&1
echo "EXIT: $?" >> /tmp/claude_test2.log

echo "" >> /tmp/claude_test2.log
echo "=== TEST 2: File creation ===" >> /tmp/claude_test2.log
claude --print --bare --dangerously-skip-permissions \
  "Create a file called hello.txt with content 'Hello from Claude Code + GLM-5.2-plus!' in the current directory. Don't say anything, just do it." >> /tmp/claude_test2.log 2>&1
echo "EXIT: $?" >> /tmp/claude_test2.log

echo "" >> /tmp/claude_test2.log
echo "=== TEST 3: File listing ===" >> /tmp/claude_test2.log
ls -la /tmp/claude_test_workspace/ >> /tmp/claude_test2.log 2>&1

echo "" >> /tmp/claude_test2.log
echo "=== TEST 4: File content ===" >> /tmp/claude_test2.log
cat /tmp/claude_test_workspace/hello.txt 2>&1 >> /tmp/claude_test2.log

echo "" >> /tmp/claude_test2.log
echo "=== TEST 5: Code generation ===" >> /tmp/claude_test2.log
claude --print --bare --dangerously-skip-permissions \
  "Create a Python script called calc.py that adds two numbers from command line args and prints result. Just create the file." >> /tmp/claude_test2.log 2>&1
echo "EXIT: $?" >> /tmp/claude_test2.log

echo "" >> /tmp/claude_test2.log
echo "=== TEST 6: Run the script ===" >> /tmp/claude_test2.log
python3 /tmp/claude_test_workspace/calc.py 5 7 2>&1 >> /tmp/claude_test2.log

echo "DONE at $(date)" >> /tmp/claude_test2.log
