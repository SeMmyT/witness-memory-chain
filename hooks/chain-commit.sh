#!/usr/bin/env bash
# chain-commit.sh — SessionEnd hook
# Reads the latest recent.md entry and commits it to the cryptographic chain.
# Also commits any valuable.sh insights that were captured this session.
# Fire-and-forget: SessionEnd can't block, we just persist.

set -uo pipefail

CHAIN_DIR="$HOME/.claude/memory-chain"
CHAIN_CLI="$HOME/codeprojects/memory-chain/dist/cli.js"

# Bail if chain not initialized
[ -f "$CHAIN_DIR/config.json" ] || exit 0
[ -f "$CHAIN_CLI" ] || exit 0

INPUT=$(cat)

HOOK_INPUT="$INPUT" python3 << 'PYEOF' 2>/dev/null || true
import json, os, subprocess, glob
from pathlib import Path
from datetime import datetime, timedelta

d = json.loads(os.environ['HOOK_INPUT'])
cwd = d.get('cwd', '')
session_id = d.get('session_id', '')

chain_dir = os.path.expanduser('~/.claude/memory-chain')
chain_cli = os.path.expanduser('~/codeprojects/memory-chain/dist/cli.js')

def chain_add(content, entry_type='memory', tier='committed'):
    """Add an entry to the chain."""
    try:
        subprocess.Popen(
            ['node', chain_cli, 'add', content, '--type', entry_type, '--tier', tier, '-d', chain_dir],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
    except:
        pass

# --- 1. Capture latest recent.md entry if written in the last 5 minutes ---

# Find the project memory dir
slug = '-' + cwd.strip('/').replace('/', '-') if cwd else ''
projects_base = os.path.expanduser('~/.claude/projects')
best = None
if os.path.isdir(projects_base) and slug:
    for dirname in os.listdir(projects_base):
        if slug.startswith(dirname) and (best is None or len(dirname) > len(best)):
            best = dirname

if best:
    recent_path = os.path.join(projects_base, best, 'memory', 'recent.md')
    if os.path.isfile(recent_path):
        mtime = os.path.getmtime(recent_path)
        age_seconds = datetime.now().timestamp() - mtime
        if age_seconds < 300:  # modified in last 5 minutes
            try:
                content = Path(recent_path).read_text()
                # Extract the latest entry (first ## block after the heading)
                lines = content.split('\n')
                entry_lines = []
                found_first = False
                for line in lines:
                    if line.startswith('## ') and not found_first:
                        found_first = True
                        entry_lines.append(line)
                    elif line.startswith('## ') and found_first:
                        break
                    elif found_first:
                        entry_lines.append(line)

                if entry_lines:
                    entry = '\n'.join(entry_lines).strip()
                    chain_add(f'[session-distill] {entry}', 'memory', 'committed')
            except:
                pass

# --- 2. Capture Sifr aftermath if available ---

try:
    import sys
    sys.path.insert(0, os.path.expanduser('~/.claude'))
    from sifr.db import get_db

    db = get_db()
    # Get the most recent session aftermath
    row = db.execute(
        "SELECT id, project, aftermath, topic FROM sessions "
        "WHERE ended_at IS NOT NULL AND aftermath IS NOT NULL "
        "ORDER BY ended_at DESC LIMIT 1"
    ).fetchone()

    if row and row['aftermath']:
        am = json.loads(row['aftermath'])
        project = row['project'] or '?'
        topic = row['topic'] or ''
        friction = am.get('friction', '?')
        outcome = am.get('outcome', '?')
        pattern = am.get('pattern', '?')

        aftermath_text = f"[session-aftermath] {project}"
        if topic:
            aftermath_text += f": {topic}"
        aftermath_text += f" | friction={friction}, outcome={outcome}, pattern={pattern}"

        chain_add(aftermath_text, 'memory', 'relationship')

    db.close()
except:
    pass
PYEOF

exit 0
