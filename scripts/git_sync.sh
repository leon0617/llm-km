#!/bin/bash
# Push /data/wiki changes to GitHub so Obsidian can pull them
# Called by the backend after every write, and also by daily cron

set -euo pipefail

DATA_DIR="$(cd "$(dirname "$0")/.." && pwd)/data"
WIKI_DIR="$DATA_DIR/wiki"
GIT_REMOTE="${GIT_REMOTE:-}"

if [ -z "$GIT_REMOTE" ]; then
  echo "GIT_REMOTE not set, skipping git sync"
  exit 0
fi

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

cd "$WIKI_DIR"

# Init repo if not already
if [ ! -d .git ]; then
  log "Initialising git repo in $WIKI_DIR"
  git init
  git remote add origin "$GIT_REMOTE"
fi

# Ensure remote is correct
git remote set-url origin "$GIT_REMOTE"

# Stage all changes
git add -A

# Only commit if there are staged changes
if git diff --cached --quiet; then
  log "No changes to commit."
  exit 0
fi

git commit -m "auto: wiki sync $(date '+%Y-%m-%d %H:%M:%S')"
git push -u origin HEAD:main

log "Pushed to $GIT_REMOTE"
