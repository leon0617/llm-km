#!/bin/bash
# Daily backup: tar /data → ~/llm-wiki-backups/YYYY-MM-DD.tar.gz
# Keep last 30 days

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$HOME/llm-wiki-backups"
DATE=$(date '+%Y-%m-%d')
ARCHIVE="$BACKUP_DIR/$DATE.tar.gz"
KEEP_DAYS=30

mkdir -p "$BACKUP_DIR"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

log "Starting backup → $ARCHIVE"
tar -czf "$ARCHIVE" -C "$COMPOSE_DIR" data
log "Backup done: $(du -sh "$ARCHIVE" | cut -f1)"

# Prune old backups
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +"$KEEP_DAYS" -delete
log "Pruned backups older than $KEEP_DAYS days."

# Also push wiki to git
bash "$COMPOSE_DIR/scripts/git_sync.sh" || true
