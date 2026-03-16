#!/usr/bin/env bash
# chain-bootstrap.sh — SessionStart hook
# Queries the cryptographic chain for relevant memories and writes
# them to a file in the project's memory directory.
# The file is auto-loaded by Claude Code as project memory.
# This closes the read loop: chain-commit writes, chain-bootstrap reads.

set -uo pipefail

CHAIN_DIR="$HOME/.claude/memory-chain"
CHAIN_CLI="$HOME/codeprojects/memory-chain/dist/cli.js"

# Bail if chain not initialized
[ -f "$CHAIN_DIR/config.json" ] || exit 0
[ -f "$CHAIN_CLI" ] || exit 0

INPUT=$(cat)

HOOK_INPUT="$INPUT" python3 << 'PYEOF' 2>/dev/null || true
import subprocess, json, os, sys
from pathlib import Path
from datetime import datetime

d = json.loads(os.environ['HOOK_INPUT'])
cwd = d.get('cwd', '')

chain_dir = os.path.expanduser('~/.claude/memory-chain')
chain_cli = os.path.expanduser('~/codeprojects/memory-chain/dist/cli.js')

if not cwd:
    sys.exit(0)

# Detect project name
sys.path.insert(0, os.path.expanduser('~/.claude'))
try:
    from sifr.db import detect_project
    project = detect_project(cwd)
except:
    project = ''

# Resolve the memory dir for this project (same logic as whisper)
slug = '-' + cwd.strip('/').replace('/', '-')
projects_base = os.path.expanduser('~/.claude/projects')
best = None
if os.path.isdir(projects_base):
    for dirname in os.listdir(projects_base):
        if slug.startswith(dirname) and (best is None or len(dirname) > len(best)):
            best = dirname

if not best:
    sys.exit(0)

memory_dir = os.path.join(projects_base, best, 'memory')
chain_file = os.path.join(memory_dir, 'chain-memories.md')

# Collect memories from the chain
memories = []

# 1. Project-specific search
if project and project != 'desktop':
    try:
        result = subprocess.run(
            ['node', chain_cli, 'search', project,
             '--max-tokens', '800', '--max-results', '5',
             '-d', chain_dir],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0 and 'Found' in result.stdout:
            for line in result.stdout.split('\n'):
                line = line.strip()
                if line.startswith('- ['):
                    memories.append(line)
    except:
        pass

# 2. Recent session distillations
try:
    result = subprocess.run(
        ['node', chain_cli, 'search', 'session-distill',
         '--max-tokens', '800', '--max-results', '8',
         '-d', chain_dir],
        capture_output=True, text=True, timeout=5
    )
    if result.returncode == 0 and 'Found' in result.stdout:
        for line in result.stdout.split('\n'):
            line = line.strip()
            if line.startswith('- [') and line not in memories:
                memories.append(line)
except:
    pass

# 3. Recent decisions (plan divergences, insights)
try:
    result = subprocess.run(
        ['node', chain_cli, 'search', 'plan-divergence OR assumption',
         '--max-tokens', '500', '--max-results', '5',
         '-d', chain_dir],
        capture_output=True, text=True, timeout=5
    )
    if result.returncode == 0 and 'Found' in result.stdout:
        for line in result.stdout.split('\n'):
            line = line.strip()
            if line.startswith('- [') and line not in memories:
                memories.append(line)
except:
    pass

# Skip if nothing found or chain is too young
if not memories:
    # Remove stale chain-memories file if it exists
    if os.path.isfile(chain_file):
        os.remove(chain_file)
    sys.exit(0)

# Write the chain memories file
os.makedirs(memory_dir, exist_ok=True)
now = datetime.now().strftime('%Y-%m-%d %H:%M')

lines = [
    '---',
    'name: Chain Memories',
    'description: Cryptographically signed memories from the chain — session distillations, decisions, and project-specific insights. Auto-updated each session start.',
    'type: project',
    '---',
    '',
    f'Relevant memories from the signed chain (queried {now}):',
    '',
]

# Limit to 15 entries to avoid context bloat
for m in memories[:15]:
    lines.append(m)

lines.append('')
lines.append(f'*{len(memories)} memories from chain. Verify: `node ~/codeprojects/memory-chain/dist/cli.js verify -d ~/.claude/memory-chain`*')

content = '\n'.join(lines) + '\n'
Path(chain_file).write_text(content)
PYEOF

exit 0
