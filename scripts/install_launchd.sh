#!/bin/bash
# Register all launchd agents for the current user
# Run once on the Mac server: bash scripts/install_launchd.sh

set -euo pipefail

LAUNCHD_DIR="$(cd "$(dirname "$0")/../launchd" && pwd)"
AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/llm-wiki"

mkdir -p "$AGENTS_DIR" "$LOG_DIR"

PLISTS=(
  com.llmwiki.app.plist
  com.llmwiki.sync-certs.plist
  com.llmwiki.backup.plist
)

for plist in "${PLISTS[@]}"; do
  src="$LAUNCHD_DIR/$plist"
  dst="$AGENTS_DIR/$plist"
  label="${plist%.plist}"

  # Unload if already loaded (ignore errors)
  launchctl unload "$dst" 2>/dev/null || true

  cp "$src" "$dst"
  launchctl load -w "$dst"
  echo "✓ Loaded $label"
done

echo ""
echo "All agents registered. To check status:"
echo "  launchctl list | grep llmwiki"
echo ""
echo "Logs are in: $LOG_DIR"
