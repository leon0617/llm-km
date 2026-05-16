# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

內部 LLM Wiki Web App，將原本 Obsidian Vault 的知識庫操作（Ingest / Query / Reflect / Lint）搬上 Web，部署於公司內網 `llm-wiki.example.com`。後端透過 Anthropic Claude API（含 Tool Use）按需讀取 wiki 頁面回答問題；前端提供聊天、上傳、瀏覽、管理介面。

詳細設計見 `ARCHITECTURE.md`、API 規格見 `API.md`、部署見 `DEPLOYMENT.md`、開發計畫見 `PLAN.md`。

## 技術棧與目錄

- **backend/** — FastAPI（Python 3.11）。入口 `app/main.py`。子模組：`auth/`（JWT + bcrypt）、`llm/`（Anthropic client、Tool Use 工具、PDF→PNG via PyMuPDF）、`routes/`（query SSE、ingest、wiki、admin）、`storage/`（wiki/raw 檔案 IO、users.json、SQLite audit log、git_sync）、`workers/`（非同步 ingest / reflect job）。
- **frontend/** — Next.js 14 App Router + TypeScript + Tailwind。Pages 在 `app/`，共用元件 `components/`，API client `lib/`，認證守門 `middleware.ts`。
- **nginx/** — 反向代理 + TLS 終止，憑證掛 `certs/`。
- **data/** — 唯一持久化卷：`wiki/`（Markdown）、`raw/`（原始來源）、`users.json`、`audit.db`、`jobs/`（job 狀態 JSON）。**不可刪、備份對象**。
- **scripts/** — `git_sync.sh`（每次寫入後 push wiki/ 到 GitHub 給 Obsidian 同步）、`backup.sh`（每日 tar `/data`，保留 30 天）、`migrate_from_obsidian.sh`、`install_launchd.sh`、`sync_certs.sh`。
- **launchd/** — macOS launchd plist，安排備份與 git sync 排程。

## 常用指令

```bash
# 全端啟動（含 nginx + TLS）
docker compose up -d --build
docker compose logs -f backend frontend nginx

# Backend 本地開發（不走 Docker）
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend 本地開發
cd frontend && npm install
npm run dev          # http://localhost:3000
npm run build && npm run start

# 備份 / 還原
./scripts/backup.sh
./scripts/git_sync.sh         # 需設 GIT_REMOTE 環境變數

# launchd 排程安裝/移除
./scripts/install_launchd.sh
./scripts/uninstall_launchd.sh
```

目前 repo 沒有測試套件（`backend/` 與 `frontend/` 皆無 test 目錄）。新增測試前先與使用者確認框架選擇。

## 架構重點（讀多檔才能掌握的關鍵）

1. **Query 走 Tool Use 按需讀檔，不做 RAG / embedding**：Backend 把 `wiki/index.md` 與 `wiki/log.md`（最近 50 條）餵給 Claude，搭配 `list_pages` / `read_page` / `search_pages` 三個 tool，由 Claude 自行決定要讀哪些頁。回應透過 SSE 串流。寫新功能時優先擴充 tool，不要把整個 wiki 塞進 context。
1.5. **多 provider + tier 路由（含 sticky pin 與 Gemini thought_signature 兩個地雷）**：`llm/router.py` 統一管理 Anthropic / OpenAI / Gemini 三家，每家標 tier（cheap / premium）。Query 預設 `auto` tier（短/簡單 → cheap、長/含分析關鍵字 → premium），Ingest/Reflect 走 premium、Lint 走 cheap。
   - **`router.stream()` 永遠以 `ProviderSelected(name, tier)` 作為第一個事件** — 不要再用任何 singleton 屬性讀 provider 名字（會 race）。
   - **Failover** 只在第 1 輪（無 tool use 歷史時）生效：2 秒內失敗且未產出輸出時自動換家。
   - **多輪 tool use 必須 sticky 同一家**：`raw_assistant_message` 是 provider-specific 不透明格式，跨家會 422/500。第 1 輪後 caller 從 `FinalResponse.provider_name` 拿到實際 provider，後續用 `force_provider=...` pin 住。`query.py` + 三個 worker 都這樣做了，新增多輪 LLM 流程時必須沿用這個 pattern。
   - **Gemini 3 系列要回傳 `thought_signature`**：thinking + function call 開啟時每個 part 有 signature，下一輪必須 echo 回去否則 400 INVALID_ARGUMENT。`gemini_provider.py` 已處理。詳細見 ARCHITECTURE.md §2.3。
2. **Wiki 頁面 schema 與 Obsidian 共用**：frontmatter 欄位（`title / type / sources / created / updated / tags / author`）與檔名前綴（`source_` / `entity_` / `concept_` / `comparison_` / `analysis_`）必須與 Obsidian Vault 一致 — `data/wiki/` 會 git push 到 `obsidian-wiki` repo 讓 Obsidian pull。**動 schema 前先看 Obsidian Vault 的 `CLAUDE.md`**。
3. **Ingest / Reflect 是非同步 job**：Route 寫 `data/jobs/{id}.json` 後立刻回 job id，worker 在背景跑並更新 progress；前端輪詢 `/api/jobs/{id}`。新增長時間任務沿用這個模式。
4. **每次寫入都觸發 git sync 與 audit log**：`storage/wiki_fs.py` 寫檔後呼叫 `scripts/git_sync.sh`，並寫一筆 `audit.db`。所有變更操作都必須記 audit（`action` 欄位見 `ARCHITECTURE.md` §3.3）。
5. **PDF Ingest 流程要圖文並茂**：用 PyMuPDF 把每頁轉 200 DPI PNG 存 `raw/assets/`，產出的 wiki 頁面以 `![[圖片名.png]]` 嵌入 — **不可純文字**。
6. **權限三層**：`admin` / `employee` / `guest`，由 `auth/jwt.py` 簽發 token，`middleware.ts` 在 frontend 做路由守門，backend route 內再驗一次。不要只信前端守門。

## 規範

- Wiki 內容、UI 文案、註解一律**繁體中文**。
- `data/raw/` 視為唯讀（人類策展來源）；產出寫到 `data/wiki/`。
- 機密走 `.env`（見 `.env.example`），不可進 repo。
- 改動 wiki schema、API 合約、audit log 欄位前，先更新對應的 `ARCHITECTURE.md` / `API.md`。
