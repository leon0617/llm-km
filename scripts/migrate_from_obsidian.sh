#!/bin/bash
set -euo pipefail

VAULT="/Users/leonl/Documents/Obsidian Vault"
TARGET="$(cd "$(dirname "$0")/.." && pwd)/data"

echo "遷移 Obsidian Vault → $TARGET"

mkdir -p "$TARGET/wiki" "$TARGET/raw/assets"

# wiki pages
rsync -av --include="*.md" --exclude="*" \
    "$VAULT/wiki/" "$TARGET/wiki/"

# raw sources (resolve symlinks: Google Drive → local copy)
rsync -av --copy-links --exclude="assets/" \
    "$VAULT/raw/" "$TARGET/raw/"

# raw/assets PNG (may be on Google Drive — must be set to "可供離線使用" first)
if [ -d "$VAULT/raw/assets" ]; then
    rsync -av --copy-links \
        "$VAULT/raw/assets/" "$TARGET/raw/assets/" || \
        echo "⚠️  raw/assets 同步失敗 — 請先在 Finder 把 Google Drive 資料夾設為可供離線使用"
fi

echo "完成。wiki 頁面數：$(ls "$TARGET/wiki/"*.md 2>/dev/null | wc -l | tr -d ' ')"
