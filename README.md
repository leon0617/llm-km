# LLM Wiki — 內部知識庫

> 內部 LLM 知識庫 Web 應用。60 人共用、部署於公司內網 `llm-wiki.example.com`。

繁體中文聊天介面查詢公司知識、上傳 PDF/TXT 由 LLM 自動 ingest 進知識庫、持續累積關於飯店 PMS、主機轉移、硬體規格的集體經驗。

採用 [Karpathy 的 llm-wiki 模式](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — **人類策展原始來源、LLM 整理摘要與交叉引用**，不做 RAG / embedding；透過 Claude API Tool Use 按需讀檔。

---

## 技術棧

| 層 | 技術 |
|---|---|
| Frontend | Next.js 14（App Router）+ TypeScript + Tailwind |
| Backend | FastAPI（Python 3.12）+ Anthropic / OpenAI / Gemini SDK |
| 反向代理 | nginx 1.27 + 自簽/LE TLS |
| 部署 | Docker Compose（單 Mac server，可平移到 Linux） |
| 認證 | JWT + httpOnly cookie + bcrypt（local）或 LDAP/AD |
| 儲存 | 純檔案系統（Markdown wiki + JSON users + SQLite audit） |
| 排程 | macOS launchd（備份、cert sync、git push） |

## 核心特色

- **多 provider LLM 路由**：Anthropic / OpenAI / Gemini 三家統一抽象、tier 分流（cheap / premium）、自動 failover、多輪 sticky pin
- **Auto-tier 啟發式**：短問題走 Gemini Flash（成本省 40 倍）、長/分析題走 Claude Sonnet
- **Tool Use agentic 導航**：`list_pages` / `read_page` / `search_pages` / `write_page` / `update_index` / `append_log`，LLM 自己決定要讀寫哪些頁
- **與 Obsidian Vault 雙向同步**：wiki/ 每次寫入自動 `git push`，Obsidian 端用 Git plugin 每 10 分鐘 pull
- **Admin 用量儀表板**：即時並發監控（tier 分組顯示）、token 用量、成本估算、按使用者 breakdown

## 快速開始（本機開發）

```bash
git clone git@github.com:leonl0617/llm-km.git
cd llm-km

# 1. 設定環境變數
cp .env.example .env
# 編輯 .env：填 ANTHROPIC_API_KEY、SECRET_KEY、ADMIN_PASSWORD 等

# 2. 啟動全端（含 nginx HTTPS）
docker compose up -d --build
docker compose logs -f backend frontend nginx

# 3. 瀏覽器開 https://localhost（自簽憑證會要點 advanced → accept）
```

第一次以 `admin` / 你設定的 `ADMIN_PASSWORD` 登入，**立即改密碼**。

## 開發文件

| 文件 | 內容 |
|---|---|
| [PLAN.md](PLAN.md) | 專案目標、階段規劃、設計決策、風險評估 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 元件責任、資料模型、LLM router、Tool Use、Prompt 設計 |
| [API.md](API.md) | REST API + SSE 事件規格 |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Mac 部署、nginx、TLS、launchd、備份、Linux 遷移 |
| [CLAUDE.md](CLAUDE.md) | 給 Claude Code 的專案記憶與開發注意事項 |

## 安全性

- `.env` / `.env_bk` / `.claude/settings.local.json` / `certs/*.pem` 已加 `.gitignore`
- 所有 API（除 `/api/auth/login`）需 JWT 認證
- 寫入操作全部進 `audit.db`，可追蹤誰、何時、做了什麼
- LLM 寫入的頁面進 `wiki/log.md` 留痕，可 `git revert`

## 授權

內部專案。
