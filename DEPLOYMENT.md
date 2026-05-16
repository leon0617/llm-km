# 部署指南

> 目標環境：Mac (Apple Silicon 或 Intel) + Docker Desktop。Linux 遷移時 docker-compose.yml 不需修改。

## 1. 系統需求

| 項目 | 規格 |
|---|---|
| CPU | 4 核以上 |
| RAM | 8GB（建議 16GB） |
| 硬碟 | 100GB 可用（含 Docker images 與第一年資料） |
| OS | macOS 13+ / Ubuntu 22.04+ |
| 軟體 | Docker Desktop 4.30+（含 docker compose v2） |
| 網路 | 固定內網 IP、可解析 `llm-wiki.example.com` |
| 對外 | 需可連 `api.anthropic.com` |

## 2. 專案目錄結構（部署後）

```
/Users/leonl/Documents/llm-wiki-web/    （或公司指定路徑）
├── docker-compose.yml
├── .env                       (API key 等機密)
├── nginx/
│   ├── nginx.conf
│   └── conf.d/
│       └── llm-wiki.conf
├── certs/                     (TLS 憑證掛載)
│   ├── fullchain.pem
│   └── privkey.pem
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   └── ... (Next.js 原始碼)
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── ... (FastAPI 原始碼)
├── data/                      (Docker volume 掛載點)
│   ├── wiki/
│   ├── raw/
│   ├── users.json
│   ├── audit.db
│   └── jobs/
├── backups/
│   └── YYYY-MM-DD.tar.gz
└── scripts/
    ├── migrate_from_obsidian.sh
    ├── backup.sh
    └── restore.sh
```

## 3. docker-compose.yml 概要

```yaml
services:
  nginx:
    image: nginx:1.27-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./certs:/etc/nginx/certs:ro
      - nginx_logs:/var/log/nginx
    depends_on: [frontend, backend]
    restart: unless-stopped

  frontend:
    build: ./frontend
    environment:
       - NEXT_PUBLIC_API_BASE=https://llm-wiki.example.com/api
    depends_on: [backend]
    restart: unless-stopped

  backend:
    build: ./backend
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - JWT_SECRET=${JWT_SECRET}
      - WIKI_DATA_DIR=/data
      - GIT_REMOTE=${GIT_REMOTE}
      - GIT_SSH_KEY_PATH=/run/secrets/git_ssh_key
    volumes:
      - ./data:/data
    secrets:
      - git_ssh_key
    restart: unless-stopped

secrets:
  git_ssh_key:
    file: ./secrets/git_ssh_key

volumes:
  nginx_logs:
```

## 4. nginx 設定

### 4.1 nginx/nginx.conf（主設定）

```nginx
user  nginx;
worker_processes  auto;
error_log  /var/log/nginx/error.log warn;
pid        /var/run/nginx.pid;

events {
    worker_connections  1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent"';

    access_log  /var/log/nginx/access.log  main;
    sendfile    on;
    keepalive_timeout  65;

    # 上傳大小（PDF 最大 50MB，留 buffer）
    client_max_body_size 60M;

    # gzip
    gzip  on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    include /etc/nginx/conf.d/*.conf;
}
```

### 4.2 nginx/conf.d/llm-wiki.conf（站台設定）

```nginx
# HTTP → HTTPS 轉址
server {
    listen 80;
    server_name llm-wiki.example.com;
    return 301 https://$host$request_uri;
}

# HTTPS 主站台
server {
    listen 443 ssl http2;
    server_name llm-wiki.example.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache   shared:SSL:10m;

    # 安全標頭
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # API 路由 → backend（含 SSE 串流支援）
    location /api/ {
        proxy_pass http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 串流必要設定（Query 端點用）
        proxy_buffering        off;
        proxy_cache            off;
        proxy_read_timeout     300s;
        proxy_send_timeout     300s;
        chunked_transfer_encoding on;
    }

    # 其餘全部給 Next.js
    location / {
        proxy_pass http://frontend:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Next.js HMR / WebSocket
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
    }
}
```

### 4.3 TLS 憑證管理

**架構**：公司有一台中央憑證主機定期續發 `*.example.com` 憑證，本機透過排程從中央主機同步至 `certs/` 後 reload nginx。

```
[中央憑證主機]  ──排程同步──►  [Mac server: certs/]  ──reload──►  [nginx 容器]
   定期續發                       fullchain.pem
                                  privkey.pem
```

**4.3.1 同步腳本** `scripts/sync_certs.sh`

```bash
#!/bin/bash
set -euo pipefail

CERT_HOST="10.0.0.1"
CERT_USER="user"
REMOTE_PATH="/etc/letsencrypt/live/example.com"
LOCAL_DIR="/Users/leonl/Documents/llm-wiki-web/certs"
LOG_FILE="/var/log/llm-wiki-cert-sync.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

log "開始同步憑證"

# 同步到暫存目錄，避免 nginx 讀到一半被替換
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

rsync -az --timeout=30 \
    -e "ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=accept-new" \
    "${CERT_USER}@${CERT_HOST}:${REMOTE_PATH}/fullchain.pem" \
    "${CERT_USER}@${CERT_HOST}:${REMOTE_PATH}/privkey.pem" \
    "$TMP_DIR/"

# 比對 fingerprint，無變動則跳過
NEW_FP=$(openssl x509 -in "$TMP_DIR/fullchain.pem" -noout -fingerprint -sha256)
OLD_FP=$(openssl x509 -in "$LOCAL_DIR/fullchain.pem" -noout -fingerprint -sha256 2>/dev/null || echo "")

if [ "$NEW_FP" = "$OLD_FP" ]; then
    log "憑證未變動，跳過"
    exit 0
fi

log "憑證有更新，套用新憑證"
log "舊：$OLD_FP"
log "新：$NEW_FP"

# 原子替換
mv "$TMP_DIR/fullchain.pem" "$LOCAL_DIR/fullchain.pem"
mv "$TMP_DIR/privkey.pem"   "$LOCAL_DIR/privkey.pem"
chmod 644 "$LOCAL_DIR/fullchain.pem"
chmod 600 "$LOCAL_DIR/privkey.pem"

# Reload nginx（zero downtime，現有連線不中斷）
cd /Users/leonl/Documents/llm-wiki-web
docker compose exec -T nginx nginx -t && \
    docker compose exec -T nginx nginx -s reload

log "nginx reload 完成"
```

**4.3.2 排程設定**（macOS launchd）

`/Library/LaunchDaemons/com.llmwiki.sync-certs.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.llmwiki.sync-certs</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/leonl/Documents/llm-wiki-web/scripts/sync_certs.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
        <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
    </array>
    <key>StandardOutPath</key>
    <string>/var/log/llm-wiki-cert-sync.out.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/llm-wiki-cert-sync.err.log</string>
</dict>
</plist>
```

每天凌晨 03:30 同步一次。Linux 遷移時改用 cron：
```cron
30 3 * * *  /opt/llm-wiki-web/scripts/sync_certs.sh
```

**4.3.3 SSH 金鑰準備**

使用現有的 `~/.ssh/id_ed25519`（公鑰已在 `~/.ssh/id_ed25519.pub`），連線 `user@10.0.0.1`。

確認連線可用：
```bash
ssh -i ~/.ssh/id_ed25519 user@10.0.0.1 \
    "ls /etc/letsencrypt/live/example.com/"
# 應看到 chain.pem fullchain.pem privkey.pem
```

若 `a99001` 對 `/etc/letsencrypt/live/` 無讀取權限（root-only），請憑證主機管理員：
```bash
# 在 10.0.0.1 上執行（一次性）
sudo chmod 755 /etc/letsencrypt/live/ /etc/letsencrypt/archive/
sudo chmod 644 /etc/letsencrypt/archive/example.com/*.pem
# 或加 a99001 至 ssl-cert group（若存在）
sudo usermod -aG ssl-cert a99001
```

**4.3.4 首次手動同步**

排程上線前，先手動跑一次填初始憑證：

```bash
sudo ./scripts/sync_certs.sh
ls -la certs/
# 應看到 fullchain.pem 與 privkey.pem
```

**4.3.5 監控告警**

憑證到期前 14 天若同步腳本未成功更新，發 email 告警：

```bash
# 健康檢查可內建在 backend /api/health：
# 回傳 cert_expires_in_days，admin 介面顯示
EXPIRES=$(openssl x509 -in certs/fullchain.pem -noout -enddate | cut -d= -f2)
DAYS_LEFT=$(( ($(date -j -f "%b %d %T %Y %Z" "$EXPIRES" +%s) - $(date +%s)) / 86400 ))
[ "$DAYS_LEFT" -lt 14 ] && echo "WARN: cert expires in $DAYS_LEFT days"
```

## 5. .env 範例

完整模板見 **`.env.example`**（單一事實來源，部署時 `cp .env.example .env` 後逐項填寫）。

關鍵欄位摘要：

| 欄位 | 必填 | 說明 |
|---|---|---|
| `ANTHROPIC_ENABLED` + `ANTHROPIC_API_KEY` | 至少一組 | 主力 premium provider |
| `OPENAI_ENABLED` + `OPENAI_API_KEY` | 選 | 備援 premium |
| `GEMINI_ENABLED` + `GEMINI_API_KEY` | 選 | cheap tier（成本壓低 40 倍） |
| `*_TIER` | 選 | 標記 provider 屬於 cheap / premium，預設 anthropic=premium、openai=premium、gemini=cheap |
| `*_WEIGHT` | 選 | 同 tier 內負載權重（搭配 `LLM_ROUTING=weighted`） |
| `LLM_ROUTING` | 選 | `round-robin`（預設）/ `pinned-by-user` / `weighted` |
| `ROUTE_QUERY` `ROUTE_INGEST` `ROUTE_REFLECT` `ROUTE_LINT` | 選 | 各操作走哪 tier；query 預設 `auto`，其餘各有預設 |
| `SECRET_KEY` | **必填** | JWT 簽章金鑰，`openssl rand -hex 32` 產生 |
| `ADMIN_USERNAME` + `ADMIN_PASSWORD` | **必填** | 首次啟動建立的管理員，登入後**立即改密碼** |
| `GIT_REMOTE` | 選 | wiki 自動 push 到此 obsidian-wiki repo（供 Obsidian 雙向同步） |
| `AD_ENABLED` + `AD_*` | 選 | LDAP/AD 認證；不啟用時只有 local 帳號 |
| `COOKIE_SECURE` | 選 | 開發環境（http）需設 `false`；生產走 https 維持預設 |

`.env` 不進 git（已加 `.gitignore`），用 `.env.example` 留模板。

**多 provider 路由詳情**見 `ARCHITECTURE.md §2.3`（tier 分流、failover 規則、sticky pin、Gemini thought_signature）。

## 6. 首次部署步驟

```bash
# 1. clone 專案
cd /Users/leonl/Documents/
git clone <project_repo> llm-wiki-web
cd llm-wiki-web

# 2. 設定 .env
cp .env.example .env
vim .env   # 填入 ANTHROPIC_API_KEY 等

# 3. 準備 Git SSH key（用於同步回 Obsidian）
mkdir -p secrets
cp ~/.ssh/id_ed25519 secrets/git_ssh_key
chmod 600 secrets/git_ssh_key

# 4. 從 Obsidian Vault 遷移現有 wiki
./scripts/migrate_from_obsidian.sh
# 此 script 內容：
#   rsync -av "/Users/leonl/Documents/Obsidian Vault/wiki/" ./data/wiki/
#   rsync -av --copy-links "/Users/leonl/Documents/Obsidian Vault/raw/" ./data/raw/
#   （--copy-links 把 Google Drive symlink 解析成實體檔）

# 5. 確認 DNS
# 在 Mac 或公司 DNS 加：
#   llm-wiki.example.com  →  <Mac server 內網 IP>

# 6a. 從中央憑證主機同步初始憑證（見第 4.3 節）
mkdir -p certs scripts
# 編輯 scripts/sync_certs.sh 設定 CERT_HOST 與 CERT_USER
chmod +x scripts/sync_certs.sh
sudo ./scripts/sync_certs.sh
ls -la certs/   # 確認 fullchain.pem 與 privkey.pem 已就位

# 6b. 第一次啟動
docker compose up -d --build

# 7. 確認服務
docker compose logs -f backend  # 等到看到 "Uvicorn running on..."
curl -k https://llm-wiki.example.com/api/health

# 8. 查看 bootstrap 管理員密碼
docker compose logs backend | grep "Bootstrap admin"
```

## 7. 60 員工帳號匯入

```bash
# 準備 CSV: users.csv
# 欄位：employee_id, email, name, role, default_password
#
# A12345,user@example.com,Leon Lin,admin,Welcome2026!
# A12346,xxx@example.com,XXX,employee,Welcome2026!
# ...

# 由管理員登入後，於前端 /admin/users 上傳，或 API：
curl -X POST https://llm-wiki.example.com/api/admin/users/import \
     -H "Cookie: wiki_token=..." \
     -F "file=@users.csv"
```

員工首次登入會被強制改密碼。

## 8. 開機自啟動（macOS launchd）

`/Library/LaunchDaemons/com.llmwiki.app.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.llmwiki.app</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/docker</string>
        <string>compose</string>
        <string>-f</string>
        <string>/Users/leonl/Documents/llm-wiki-web/docker-compose.yml</string>
        <string>up</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/leonl/Documents/llm-wiki-web</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key>
    <string>/var/log/llm-wiki.out.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/llm-wiki.err.log</string>
</dict>
</plist>
```

```bash
sudo launchctl load /Library/LaunchDaemons/com.llmwiki.app.plist
```

注意：Docker Desktop 需設定為「開機時啟動」，不然 docker daemon 不在會失敗。

## 9. 備份策略

### 9.1 即時：Git push
- 每次 wiki 寫入後背景 `git commit -m "..." && git push`
- 用獨立 GitHub private repo
- 復原：`git clone` 即得最新 wiki

### 9.2 每日：本機 tarball
```bash
# scripts/backup.sh
DATE=$(date +%Y-%m-%d)
docker compose stop
tar czf backups/${DATE}.tar.gz data/
docker compose start
# 保留最近 30 天
find backups/ -mtime +30 -delete
```

cron（macOS launchd 或 `crontab -e`）：
```
0 2 * * *  /Users/leonl/Documents/llm-wiki-web/scripts/backup.sh
```

### 9.3 每週：外接硬碟同步
```bash
rsync -av backups/ /Volumes/Backup/llm-wiki/
```

## 10. 監控與告警

### 10.1 健康檢查
- `GET /api/health` → 200 + JSON `{ "status": "ok", "wiki_pages": 23 }`
- 每分鐘 cron 檢查，失敗連 3 次 → email 通知 admin

### 10.2 日誌
- nginx access log → `docker compose logs nginx` 或掛載至 `nginx_logs` volume（`/var/log/nginx/access.log`、`error.log`）
- Backend：FastAPI 預設 stdout，用 `docker compose logs --tail=1000`
- Audit log：API `/api/admin/audit`

### 10.3 LLM 用量與並發監控
- Backend 統計每日 input/output tokens 與 USD 成本，分 provider 寫到 SQLite
- Admin `/admin/usage` 顯示：總 token / 成本卡片、每日趨勢圖、按使用者 breakdown
- Admin `/admin/usage` 即時 queue card（每 5 秒輪詢 `/api/admin/llm/queue`）顯示：
  - 各 provider 的 in_use / max_concurrent slot bar
  - 失敗計數（fail_count，含 failover 觸發）
  - 按 tier 分組（premium / cheap）顯示
- `Gemini` 用量 / 配額異常 → 透過 `fail_count` 持續上升即可發現

## 11. 升級流程

```bash
cd /Users/leonl/Documents/llm-wiki-web
git pull
docker compose build
docker compose up -d
docker compose ps  # 確認服務正常
```

升級前自動 backup（升級 script 內建）。

## 12. 從 Mac 遷移到 Linux Server

當公司決定移到正式 server：

```bash
# 在舊 Mac
docker compose stop
tar czf llm-wiki-migration.tar.gz \
    docker-compose.yml nginx/ certs/ .env data/ secrets/ \
    frontend/ backend/

scp llm-wiki-migration.tar.gz user@new-server:/opt/

# 在新 Linux server
cd /opt
tar xzf llm-wiki-migration.tar.gz
cd llm-wiki-web
docker compose up -d --build
```

DNS 改指向新 server IP 即可。資料、設定、密碼皆延續。

## 13. 故障排除

| 症狀 | 排查 |
|---|---|
| nginx 報 502 | `docker compose logs frontend` / `backend`，看是否啟動完成；`docker compose exec nginx nginx -t` 檢查設定 |
| nginx 啟動即崩潰 | 多半是 certs/ 路徑不對或權限錯；確認 `certs/fullchain.pem` 與 `privkey.pem` 存在且 nginx user 可讀 |
| SSE 串流被截斷 | 確認 nginx.conf 內 `proxy_buffering off` 已設定 |
| 登入後立刻被踢出 | JWT_SECRET 在重啟間變了？檢查 `.env` 是否被覆寫 |
| Anthropic 429 | 超量；查 audit log 找誰短時間打太多 |
| Wiki 寫入消失 | 檢查 Volume mount 是否正確；`docker compose config` 看 |
| Git push 失敗 | secrets/git_ssh_key 權限或 GitHub Deploy Key 失效 |
| PDF ingest 卡住 | pymupdf 對部分加密 PDF 會死當；timeout 30s 自動失敗並寫 log |

## 14. 安全檢查清單（上線前）

- [ ] `.env` 不在 git，用 `.gitignore` 確認
- [ ] JWT_SECRET 隨機產生 ≥32 bytes
- [ ] BOOTSTRAP_ADMIN_PASSWORD 首次登入後立即變更
- [ ] `/data/users.json` 權限 600
- [ ] nginx HSTS 已啟用（`Strict-Transport-Security` 標頭）
- [ ] TLS 憑證同步排程已啟用（launchd / cron），到期前 14 天告警
- [ ] HTTP 80 已強制 301 轉址至 HTTPS
- [ ] Anthropic API Key 不在前端 bundle
- [ ] 操作日誌 60 天內可追溯
- [ ] 每日備份 cron 已啟用且測試過 restore
- [ ] CSV 匯入帳號的預設密碼用一次性、各人不同
