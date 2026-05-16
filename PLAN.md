# LLM Wiki Web 專案規劃

> 將個人版 llm-wiki 知識庫升級為內部 Web 應用，60 人共用，部署於 Mac server。

## 1. 專案目標

把現有的 Obsidian + Claude Code CLI 個人知識庫，轉換成內網 Web 系統，讓**60 位員工**不需安裝任何工具即可：

- 用繁體中文聊天介面查詢公司知識
- 上傳 PDF / 文字檔交由 LLM 自動 ingest 進知識庫
- 持續累積關於飯店 PMS、主機轉移、硬體規格的集體經驗

## 2. 核心原則：保留 llm-wiki 架構

**不使用 RAG（向量檢索）**。沿用 Karpathy llm-wiki 模式：

- 人類負責**策展原始來源**（raw/）
- LLM 負責**整理摘要與交叉引用**（wiki/）
- 查詢時 Claude 走訪 `wiki/index.md` → 找到相關頁 → 讀取頁面內文 → 合成答案
- Wiki 頁面本身就是「壓縮過、結構化」的知識，不需要再做向量嵌入

技術上以 **Claude API 的 Tool Use** 實作 agentic 導航：定義 `list_pages` / `read_page` / `search_pages` 三個工具，由 Claude 自行決定要讀哪些頁來回答問題。

## 3. 範圍界定

### 第一版必須（MVP）
- 登入、改密碼
- Query：聊天介面，串流回覆，附頁面引用
- Ingest：上傳 PDF/TXT/MD/網頁清理過的內容，產出 wiki 頁
- Browse：wiki 頁面瀏覽（樹狀目錄 + Markdown 渲染）
- Admin：建立帳號、Reflect、Lint、Scan
- HTTPS（nginx）+ 開機自啟動

### 第一版不做
- 即時協作編輯
- 全文搜尋（讓 Claude 處理檢索）
- 行動 App（純 Web，響應式即可）
- SSO / AD 整合（後續可加）
- 知識圖譜視覺化（之後做 json-canvas skill）

## 4. 階段規劃

| 階段 | 範圍 | 完工標準 |
|---|---|---|
| **1. 骨架** | Docker Compose、FastAPI + Next.js 啟動、wiki 檔案讀寫、瀏覽現有 wiki | 本機 `localhost:3000` 可瀏覽從 Obsidian 匯入的 wiki 頁面 |
| **2. Query + Ingest** | Claude API Tool Use、聊天 SSE、PDF→PNG、檔案上傳、操作日誌 | 員工可登入、提問、上傳文件 ingest |
| **3. 認證 + 管理** | JWT 登入、密碼首次強制變更、員工/管理員角色、Reflect/Lint/Scan | 管理員可建 60 個帳號，差異化權限生效 |
| **4. 部署** | nginx HTTPS、launchd 自啟、Git 同步回 Obsidian、每日備份、監控告警 | `https://llm-wiki.example.com` 可從公司網路存取 |

每階段都可獨立交付與展示。

## 5. 關鍵設計決策

| 決策 | 選擇 | 為什麼 |
|---|---|---|
| 檢索方式 | **Tool Use agentic 導航**，非 RAG | 保留 llm-wiki 精神；wiki 頁本身已壓縮，無需再 embed |
| 儲存格式 | **Markdown 檔（檔案系統）** | 與 Obsidian Vault 完全相容，可雙向同步、git 版控 |
| 後端語言 | **Python + FastAPI** | Anthropic SDK 成熟、pymupdf 原生支援、SSE 串流容易 |
| 前端框架 | **Next.js + Tailwind** | 中文字體支援好、聊天 UI 元件生態齊全、單一 Dockerfile |
| 認證 | **JWT + httpOnly cookie + bcrypt** | 60 人內網不需 OAuth；首次登入強制改密碼 |
| 帳號建置 | **管理員 CSV 匯入** | 60 人一次到位；有預設密碼但首次強制改 |
| 部署 | **Docker Compose + nginx** | Mac 上跑得動；遷移到 Linux server 只需搬 docker-compose.yml |
| 反向代理 | **nginx** | IT 部門熟悉、生態成熟、SSE 支援穩定；憑證以 certbot/自簽搭配 |
| 大檔處理 | **本機 Volume**（不用 Google Drive） | 公司內網不依賴外部服務 |
| 備份 | **每日 git push 到 GitHub private repo + Volume snapshot** | 雙保險，可離線還原 |

## 6. 資安考量

| 風險 | 對策 |
|---|---|
| 客戶資料外洩 | Anthropic API 呼叫不傳送密碼類欄位；Ingest 時提示使用者勿上傳含帳密文件 |
| 內網非法存取 | nginx 強制 HTTPS（HTTP 301 → HTTPS）、JWT 驗證、操作日誌完整保留 |
| LLM 幻覺寫錯資料 | 所有 LLM 寫入操作都進 `wiki/log.md` 留痕；管理員可一鍵 git revert |
| Prompt injection | 使用者上傳的內容用獨立 user role 訊息傳遞，與 system prompt 分離 |
| Rate limit | 後端對 Claude API 加排隊機制，避免 60 人同時打爆 |

## 7. 與 Obsidian Vault 的關係

Web 系統與 Leon 個人 Obsidian Vault 維持**雙向同步**：

```
Mac server (/data/wiki)  ⇄  Git (private repo)  ⇄  Leon's Obsidian Vault
```

- Web 系統每次寫入後自動 git commit + push
- Obsidian Git 外掛每 10 分鐘 pull
- 衝突處理：Web 為主來源（多人寫）、Obsidian 為個人副本

## 8. 開放問題（待解）

- [ ] 公司內網 DNS 是否已能解析 `llm-wiki.example.com`？或需配合 IT 設定？
- [x] TLS 憑證：`user@10.0.0.1`，路徑 `/etc/letsencrypt/live/example.com/`，金鑰用 `~/.ssh/id_ed25519`，每日 03:30 排程同步
- [ ] 60 位員工帳號 CSV 由誰準備？格式：`employee_id, email, name, role`
- [ ] Mac server 的硬碟空間？預估第一年 wiki + raw 約需 50GB（含 PDF 轉 PNG）
- [ ] 是否需要為其他協力廠商（如 PB）開設訪客帳號？
- [ ] 公司是否有既有的 GitHub Org，可作為備份 repo？

## 9. 風險與緩解

| 風險 | 影響 | 緩解 |
|---|---|---|
| Mac server 故障 | 全公司無法使用 | 每日備份 + Docker Compose 可在另一台 Mac/Linux 5 分鐘內復原 |
| Anthropic API 中斷 | Query/Ingest 不可用，但 Browse 仍可 | 前端顯示降級提示，Browse 不受影響 |
| Wiki 結構崩壞（LLM 寫壞） | 知識可信度下降 | log.md 留痕 + git 版控，可任意回溯 |
| 60 人並發超出 API 限額 | 排隊延遲 | 後端 in-memory queue，必要時申請 Anthropic 提高限額 |
| 員工上傳含敏感帳密文件 | 資料外洩風險 | Ingest 前由 LLM 自動偵測並警告；管理員可審核 raw/ |

## 10. 文件索引

| 文件 | 內容 |
|---|---|
| [PLAN.md](PLAN.md) | 本文件，策略與階段規劃 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 系統元件、資料模型、核心流程、Prompt 設計 |
| [API.md](API.md) | REST API 端點規格 |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Mac 部署步驟、Docker、nginx、備份、遷移 |
