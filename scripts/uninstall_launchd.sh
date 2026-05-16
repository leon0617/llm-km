#!/bin/bash
set -euo pipefail
AGENTS_DIR="$HOME/Library/LaunchAgents"
for plist in com.llmwiki.app.plist com.llmwiki.sync-certs.plist com.llmwiki.backup.plist; do
  dst="$AGENTS_DIR/$plist"
  launchctl unload "$dst" 2>/dev/null && echo "✓ Unloaded ${plist%.plist}" || true
  rm -f "$dst"
done
