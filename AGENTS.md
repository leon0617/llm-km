# AGENTS.md — LLM Wiki 快速上手指南

> 給 AI agent 的高密度上手筆記。每條都是「不看容易踩坑」的資訊。

---

## 專案定位

內部 LLM Wiki Web App。**不做 RAG / embedding**，用 Claude Tool Use 按需讀 wiki 頁面。
部署目標：`llm-wiki.example.com`（公司內網，單 Mac server）。

---

## 開發指令

```bash
# 全端（Docker）— 注意：host port 是 8077/10443，不是 80/443
docker compose up -d --build
docker compose logs -f backend frontend nginx

# Backend 本地（Python 3.12）
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend 本地（Node 20）
cd frontend && npm install
npm run dev        # http://localhost:3000
npm run build && npm run start
```

**沒有測試套件**（backend/ 和 frontend/ 均無 tests/）。新增測試前先詢問使用者框架選擇。

**沒有 linter / formatter 設定檔**（無 `.eslintrc`、`ruff.toml`、`.prettierrc`）。前端無 `package-lock.json`。

---

## 目錄結構（重點）

| 路徑 | 說明 |
|---|---|
| `backend/app/main.py` | FastAPI 入口 |
| `backend/app/config.py` | 環境變數、路徑設定 |
| `backend/app/errors.py` | 統一錯誤格式 |
| `backend/app/llm/router.py` | 多 provider 路由核心（必讀） |
| `backend/app/llm/auto_tier.py` | 啟發式 tier 判定 |
| `backend/app/llm/providers/` | Anthropic / OpenAI / Gemini 三家實作 |
| `backend/app/llm/tools.py` | Tool Use 工具定義（`list_pages` / `read_page` / `search_pages` / `write_page` 等） |
| `backend/app/llm/prompts.py` | System prompts（query / ingest / reflect / lint） |
| `backend/app/llm/pdf.py` | PyMuPDF PDF→PNG + LibreOffice Office→PDF |
| `backend/app/routes/query.py` | SSE 串流 Query 路由 |
| `backend/app/routes/ingest.py` | 文件 ingest 路由（非同步 job） |
| `backend/app/routes/wiki.py` | wiki 瀏覽 API |
| `backend/app/routes/admin.py` | 管理員 API |
| `backend/app/storage/wiki_fs.py` | wiki 檔案 IO（寫檔後自動 git sync + audit log） |
| `backend/app/storage/sessions.py` | 聊天對話 + token 用量 + 成本估算 |
| `backend/app/storage/jobs.py` | Job 狀態 JSON（`data/jobs/{id}.json`） |
| `backend/app/workers/` | 4 個非同步 worker：`ingest_worker.py`、`reflect_worker.py`、`lint_worker.py`、`scan_worker.py` |
| `frontend/app/` | Next.js 14 App Router（standalone output 模式） |
| `frontend/middleware.ts` | 前端路由守門（JWT 驗證，僅 UX，不可信賴） |
| `data/` | **唯一持久化卷，不可刪** |
| `scripts/` | `git_sync.sh`、`backup.sh`、`sync_certs.sh`、`migrate_from_obsidian.sh`、`install_launchd.sh` |
| `launchd/` | macOS launchd plist 模板 |

---

## 關鍵架構地雷（踩過才知道）

### 1. 多輪 Tool Use 必須 sticky 同一家 provider

`raw_assistant_message` 是 provider-specific 格式，跨 provider 傳會 422/500。

- 第 1 輪：`router.stream()` 的**第一個事件永遠是 `ProviderSelected(name, tier)`**，從這裡拿實際 provider 名稱。不要用任何 singleton 屬性讀（race condition）。
- 後續輪：用 `force_provider=<name>` 把請求 pin 住同一家。
- 參考實作：`routes/query.py` 和四個 worker（`workers/`）都已正確實作，新增多輪 LLM 流程必須沿用此 pattern。

### 2. Gemini 3 系列 `thought_signature` 地雷

thinking + function call 開啟時，每個 part 有 `thought_signature`，下一輪**必須 echo 回去**，否則 400 INVALID_ARGUMENT。`gemini_provider.py` 已處理，細節見 `ARCHITECTURE.md §2.3`。

### 3. Failover 只在第 1 輪生效

2 秒內失敗且未產出任何輸出時自動換 provider。一旦開始串流輸出就不再換。

### 4. Tier 路由規則

| 操作 | Tier |
|---|---|
| Query（短/簡單） | cheap（auto 啟發式） |
| Query（長/含分析關鍵字） | premium（auto 啟發式） |
| Ingest / Reflect | premium |
| Lint | cheap |

在 `.env` 中可用 `ROUTE_QUERY=` / `ROUTE_LINT=` 等覆寫。

### 5. Frontend standalone 模式

Next.js 用 `output: "standalone"` 打包，Dockerfile 只複製 `.next/standalone` + `.next/static` + `public`。Server-side 呼叫 backend 用 `INTERNAL_API_BASE=http://backend:8000/api`（Docker 內部 DNS），client-side 用 `NEXT_PUBLIC_API_BASE=/api`（透過 nginx proxy）。

### 6. Docker port mapping

實際 compose 映射 `8077:80` 和 `10443:443`，不是標準 port。開發時用 `https://localhost:10443` 或 `http://localhost:8077`。

### 7. Backend Dockerfile 含 LibreOffice

除了 PyMuPDF，還裝了 LibreOffice headless（Office→PDF 轉換）和 `fonts-noto-cjk`（繁中字型）。build 時間較長。

---

## Wiki 頁面規範（與 Obsidian 共用）

**動 schema 前必須同步 Obsidian Vault 的 `CLAUDE.md`。**

- frontmatter 必填欄位：`title / type / sources / created / updated / tags / author`
- 檔名前綴：`source_` / `entity_` / `concept_` / `comparison_` / `analysis_`
- `data/wiki/` 每次寫入自動 `git push` 到 `obsidian-wiki` repo（Obsidian 端 Git plugin 每 10 分鐘 pull）
- `data/raw/` 視為唯讀（人類策展來源），不可讓 LLM 寫入

---

## 非同步 Job 模式

長時間任務（Ingest / Reflect / Lint / Scan）遵循此 pattern：
1. Route 寫 `data/jobs/{id}.json` 後立刻回 job id
2. Worker 在背景跑，持續更新 progress JSON
3. 前端輪詢 `/api/jobs/{id}`

新增長時間任務一律沿用此模式。

---

## 每次寫 wiki 必做的兩件事

`storage/wiki_fs.py` 已封裝，但自己新增寫入路徑時注意：
1. **呼叫 `scripts/git_sync.sh`**（需設 `GIT_REMOTE` 環境變數）
2. **寫一筆 `audit.db`**（`action` 欄位定義見 `ARCHITECTURE.md §3.3`）

---

## PDF / Office Ingest 規定

用 PyMuPDF 把每頁轉 200 DPI PNG 存 `raw/assets/`，wiki 頁面內以 `![[圖片名.png]]` 嵌入。**不可純文字輸出。** Office 檔（docx/xlsx/pptx）先經 LibreOffice headless 轉 PDF 再走同一流程。

---

## 權限模型

三層：`admin` / `employee` / `guest`

- JWT 由 `auth/jwt.py` 簽發
- 前端 `middleware.ts` 守門（僅做 UX，不可信賴）
- **後端 route 內必須再驗一次**，不能只信前端守門
- 支援 LDAP/AD 認證（`AD_ENABLED=true`），帳號可標記 `auth_source=ad`，登入時 LDAP bind 到公司 AD

---

## 環境變數重點

完整模板見 `.env.example`（單一事實來源）。

| 變數 | 說明 |
|---|---|
| `ANTHROPIC_API_KEY` | 必填（至少一家 provider） |
| `SECRET_KEY` | JWT 簽名，至少 32 chars random，用 `openssl rand -hex 32` 產生 |
| `ADMIN_PASSWORD` | 首次啟動後立即修改 |
| `GIT_REMOTE` | wiki/ 自動 push 目標，選填 |
| `COOKIE_SECURE` | 本機 http 開發時設 `false`，預設 `true` |
| `LLM_ROUTING` | `round-robin`（預設）/ `pinned-by-user` / `weighted` |
| `ROUTE_QUERY` / `ROUTE_INGEST` 等 | 各操作走哪 tier，query 預設 `auto` |
| `AD_ENABLED` + `AD_*` | LDAP/AD 認證，選填 |
| `INTERNAL_API_BASE` | Frontend server-side→backend URL（Docker 內用 `http://backend:8000/api`） |

機密一律走 `.env`，不可進 repo。

---

## 語言規範

Wiki 內容、UI 文案、程式碼註解一律**繁體中文**。

---

## 變更前必讀的文件

- 改 wiki schema → 先看 Obsidian Vault 的 `CLAUDE.md`
- 改 API 合約 → 更新 `API.md`
- 改 audit log 欄位 → 更新 `ARCHITECTURE.md §3.3`
- 改 LLM 路由/provider → 讀 `ARCHITECTURE.md §2.3`

---

## 參考文件

- `ARCHITECTURE.md` — 元件責任、LLM router、Tool Use、Prompt 設計
- `API.md` — REST API + SSE 事件規格
- `DEPLOYMENT.md` — Docker、nginx、TLS、launchd、備份
- `PLAN.md` — 專案目標與階段規劃
- `CLAUDE.md` — Claude Code 專案記憶
