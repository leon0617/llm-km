#!/bin/bash
# Sync TLS certs from cert host and reload nginx
# Run via launchd every 12 hours (certs renew every 90 days)

set -euo pipefail

CERT_HOST="a99001@10.10.100.35"
CERT_DIR="/etc/letsencrypt/live/example.com"
SSH_KEY="$HOME/.ssh/id_ed25519"
LOCAL_CERT_DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

log "Syncing certs from $CERT_HOST:$CERT_DIR"

rsync -az --delete \
  -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10" \
  "$CERT_HOST:$CERT_DIR/fullchain.pem" \
  "$CERT_HOST:$CERT_DIR/privkey.pem" \
  "$LOCAL_CERT_DIR/"

log "Certs synced. Reloading nginx..."
cd "$COMPOSE_DIR"
docker compose exec -T nginx nginx -s reload

log "Done."
