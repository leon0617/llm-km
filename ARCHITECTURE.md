# 系統架構設計

## 1. 整體架構

```
                  ┌──────────────────────────────────────┐
                   │     llm-wiki.example.com             │
                  │     (公司內網 DNS)                     │
                  └────────────────┬─────────────────────┘
                                   │ HTTPS
                                   ▼
                  ┌──────────────────────────────────────┐
                  │  Mac Server                          │
                  │  ┌────────────────────────────────┐  │
                  │  │  nginx (Reverse Proxy + TLS)   │  │
                  │  └──────┬─────────────────┬───────┘  │
                  │         │                 │           │
                  │         ▼                 ▼           │
                  │  ┌────────────┐    ┌─────────────┐   │
                  │  │  Frontend  │    │   Backend   │   │
                  │  │  Next.js   │◄──►│   FastAPI   │   │
                  │  │  :3000     │    │   :8000     │   │
                  │  └────────────┘    └──────┬──────┘   │
                  │                           │           │
                  │  ┌────────────────────────┴────────┐  │
                  │  │         Persistent Volume        │  │
                  │  │  /data/wiki/      (Markdown)     │  │
                  │  │  /data/raw/       (Sources)      │  │
                  │  │  /data/users.json (Accounts)     │  │
                  │  │  /data/audit.db   (SQLite log)   │  │
                  │  │  /data/jobs/      (Async state)  │  │
                  │  └─────────────────────────────────┘  │
                  └────────────────┬─────────────────────┘
                                   │
                                   ▼
                  ┌──────────────────────────────────────┐
                  │         Anthropic Claude API         │
                  │  (Claude Sonnet 4.6 for Query/Ingest)│
                  └──────────────────────────────────────┘
```

## 2. 元件責任

### 2.1 Frontend (Next.js)

| 路徑 | 用途 | 權限 |
|---|---|---|
| `/login` | 登入畫面 | 公開 |
| `/` | 聊天介面（Query） | 員工以上 |
| `/ingest` | 文件上傳 + 進度 | 員工以上 |
| `/browse` | Wiki 瀏覽（樹狀 + 渲染） | 員工以上 |
| `/browse/[...slug]` | 單頁渲染（含 wiki link 跳轉） | 員工以上 |
| `/admin/users` | 帳號管理 | 管理員 |
| `/admin/operations` | Reflect / Lint / Scan | 管理員 |
| `/admin/audit` | 操作日誌 | 管理員 |
| `/account` | 改密碼 | 員工以上 |

### 2.2 Backend (FastAPI)

```
backend/app/
├── main.py              FastAPI entry, middleware, CORS
├── config.py            環境變數、路徑設定
├── auth/
│   ├── jwt.py           Token 簽發、驗證
│   ├── password.py      bcrypt
│   └── routes.py        /api/auth/*
├── llm/
│   ├── client.py        統一 LLM facade（透過 router 路由）
│   ├── router.py        多 provider 路由 + tier 分流 + failover
│   ├── auto_tier.py     啟發式 tier 判定（短/簡單 → cheap、複雜 → premium）
│   ├── tools.py         Tool Use 定義（list_pages, read_page, search_pages）
│   ├── prompts.py       System prompts（query / ingest / reflect / lint）
│   ├── pdf.py           pymupdf PDF→PNG
│   └── providers/
│       ├── base.py              抽象介面 + 事件型別（ProviderSelected/TextDelta/FinalResponse）
│       ├── anthropic_provider.py
│       ├── openai_provider.py
│       └── gemini_provider.py
├── routes/
│   ├── query.py         /api/query (SSE)
│   ├── ingest.py        /api/ingest, /api/jobs/{id}
│   ├── wiki.py          /api/wiki/*
│   └── admin.py         /api/admin/*
├── storage/
│   ├── wiki_fs.py       讀寫 wiki/*.md
│   ├── wiki_index.py    維護 wiki/index.md
│   ├── users.py         users.json CRUD
│   ├── sessions.py      聊天對話 + token 用量 + 成本估算
│   ├── jobs.py          非同步 job 狀態管理
│   └── audit.py         SQLite 日誌
└── workers/
    ├── ingest_worker.py 非同步 ingest job
    ├── reflect_worker.py 非同步 reflect job
    ├── lint_worker.py   非同步 lint job
    └── scan_worker.py   非同步 scan job
```

### 2.3 LLM Router 與多 provider 路由

支援 Anthropic / OpenAI / Gemini 三家 provider，透過 `app/llm/router.py` 統一管理：

**Tier 分流**：每個 provider 註冊時標記 `tier`（`cheap` / `premium`），各操作走預設 tier：

| 操作 | 預設 tier | 設定旗標 |
|---|---|---|
| Query（聊天） | `auto`（按啟發式決定） | `route_query` |
| Lint（唯讀檢查） | `cheap` | `route_lint` |
| Ingest（整理） | `premium` | `route_ingest` |
| Reflect（合成洞察） | `premium` | `route_reflect` |

Auto 啟發式（`auto_tier.py`）：問題 ≥ 200 字、含「比較/分析/為什麼/差異」等關鍵字、或對話深度 ≥ 2 輪 → 升 premium，否則 cheap。

**路由策略**（`LLM_ROUTING` 環境變數）：
- `round-robin`（預設）— tier 內輪流
- `pinned-by-user` — 同使用者固定 provider
- `weighted` — 依 `*_WEIGHT` 比例

**`ProviderSelected` 事件協議**：`router.stream()` 永遠以 `ProviderSelected(name, tier)` 作為第一個事件。歷史上 router 把 provider 名字寫進 singleton 屬性，多請求併發會 race；改成事件後每個請求各自的 async generator instance 擁有自己的流，不會互蓋。

**Failover**：第一順位 provider 若 **(a)** 在 `FAILOVER_WINDOW_SECONDS = 2.0` 秒內失敗 **(b)** 且尚未 yield 任何 `TextDelta`/`FinalResponse`，router 自動換下一個候選並 yield 新的 `ProviderSelected`；前端 badge 會跟著更新成實際跑的 provider。`asyncio.CancelledError`（client 斷線）立即上拋，不重試。計時起點是「拿到 semaphore 之後」，不含排隊等待時間。

**Tier silent fallback**：請求 tier 沒有任何 provider 匹配時（例如只設了 premium 但呼叫 cheap），`pick()` 自動退到所有 provider。實際被選中的 tier 由 `ProviderSelected.tier` 回報，caller 應以該值為準。

**Sticky provider（多輪 tool use 必須 pin 同一家）**：`FinalResponse.raw_assistant_message` 是 **provider-specific 的不透明格式**（Anthropic 的 content blocks ≠ Gemini 的 `parts` ≠ OpenAI 的 message dict）。一旦第 1 輪產生 tool_use 並把 raw 訊息塞進 history，第 2 輪**必須**回到同一家，否則 router 把 Gemini 原生訊息餵給 Anthropic 直接 422 / 500。

實作上：`router.stream()` 接 `force_provider: Optional[str]` 參數，跳過 `pick()` 直接用指定 slot 且**不 failover**。Caller 第 1 輪後從 `FinalResponse.provider_name`（由 router 注入）拿到實際 provider name，後續每輪都帶 `force_provider=pinned`。`query.py` 與三個 worker（ingest / reflect / lint）都遵循這個 pattern。

若 `force_provider` 指定的 slot 不存在（例如 provider 重啟後被下線），router 拋 `RuntimeError("指定 provider 不存在或已下線")`，前端 SSE 回 `event: error`；使用者需要開新對話重試。

**Gemini thought_signature**：`gemini-flash-latest`（→ `gemini-3-flash-preview`）開啟 thinking + function calling 時，每個 part 帶 `thought_signature`；下一輪必須把該 signature **原封不動 echo 回去**，否則 Gemini 回 `400 INVALID_ARGUMENT: Function call is missing a thought_signature`。`gemini_provider.py` 在收 chunk 時把每個 part 的 `thought_signature` 與 `text` / `function_call` 一起塞進 `response_parts`，作為 `raw_assistant_message` 一部分傳回。新增 Gemini-side 模型若同樣有 thinking 機制，要確認這條路徑仍正確。

## 3. 資料模型

### 3.1 Wiki 頁面格式（不變）

沿用 [Obsidian Vault CLAUDE.md](file:///Users/leonl/Documents/Obsidian%20Vault/CLAUDE.md) 已定義的 schema：

```yaml
---
title: 頁面標題
type: summary | entity | concept | comparison | analysis
sources: [來源檔案列表]
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [相關標籤]
author: 上傳者員工編號  # 新增欄位
---
```

命名前綴：`source_` / `entity_` / `concept_` / `comparison_` / `analysis_`

### 3.2 users.json

```json
{
  "users": [
    {
      "employee_id": "A12345",
        "email": "user@example.com",
      "name": "Leon Lin",
      "password_hash": "$2b$12$...",
      "role": "admin",
      "must_change_password": true,
      "created_at": "2026-05-04T10:00:00+08:00",
      "last_login_at": null,
      "active": true
    }
  ]
}
```

### 3.3 audit.db (SQLite)

```sql
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  action      TEXT NOT NULL,    -- login / query / ingest / reflect / lint / page_write
  target      TEXT,             -- 頁面名 / job id / 受影響資源
  detail      TEXT,             -- JSON: 完整參數
  result      TEXT NOT NULL     -- success / failure
);

CREATE INDEX idx_audit_employee ON audit_log(employee_id, timestamp);
CREATE INDEX idx_audit_action ON audit_log(action, timestamp);
```

### 3.4 Job 狀態（檔案 JSON）

`/data/jobs/{job_id}.json`：

```json
{
  "id": "ingest_20260504_abc123",
  "type": "ingest",
  "status": "running",
  "progress": 0.6,
  "step": "正在產出 wiki 頁面",
  "logs": ["..."],
  "input": { "filename": "...", "uploader": "A12345" },
  "output": { "pages_created": ["entity_xxx.md"] },
  "created_at": "2026-05-04T10:00:00+08:00",
  "completed_at": null,
  "error": null
}
```

## 4. 三大核心流程

### 4.1 Query 流程

```
User 輸入問題
  ↓
Frontend POST /api/query (SSE 連線)
  ↓
Backend:
  1. JWT 驗證 + 開啟 / 接續 session（sessions.py）
  2. auto_tier 啟發式 → 決定 chosen_tier（cheap / premium）
  3. 載入 wiki/index.md（首輪）或對話歷史（續輪）
  4. router.stream() →
     ├─ yield ProviderSelected(name, tier) ← 第一個事件，前端更新 badge
     ├─ 若 provider 失敗在 2 秒內：yield 新 ProviderSelected，換家重試
     └─ 串 TextDelta / FinalResponse 出來
  5. 多輪 Tool 呼叫（最多 MAX_TURNS=12, MAX_TOOL_CALLS=24）：
     ├─ list_pages / read_page / search_pages
     └─ 合成回答（含 [[wiki link]]）
  6. 結尾 SSE：usage（含 tokens/cost/provider/tier）+ citations + done
  7. 寫入 session + audit log
  ↓
Frontend 渲染 Markdown，wiki link 變成可點選跳轉
```

**關鍵**：所有頁面內容都是「按需讀取」，Claude 看到 index 後自己決定要哪些頁。Wiki 頁面平均約 1-3KB，一次讀 10 頁也只佔 30KB context，遠低於 200K 窗口。

**Tier 解析**：`chosen_tier` 一開始是 auto_tier 的猜測（請求 tier），但 router 實際選中的 slot 透過 `ProviderSelected.tier` 回報；`query.py` 用 event 的值覆寫 `chosen_tier`，所以 audit log、SSE usage event、前端 badge 拿到的都是「實際發生的事」，不是請求時的猜測。

### 4.2 Ingest 流程

```
 User 上傳檔案（PDF/TXT/MD）
   ↓
 Frontend POST /api/ingest (multipart)
   ↓
 Backend:
   1. 存原始檔到 /data/raw/{年月}/{原檔名}
   2. 建立 job，回 job_id 給前端
   3. 前端輪詢 /api/jobs/{id} 顯示進度
   4. ingest_worker 非同步：
      ├─ 若是 PDF：pymupdf 轉每頁 200 DPI PNG → /data/raw/assets/
      ├─ 讀取 PDF 文字層（fitz.get_text()）
      ├─ 掃描版 PDF 偵測：若總字數 < 100 或唯一頁數 ≤ 2（全頁文字幾乎相同），
      │   視為掃描版，啟用 OCR fallback：
      │   ├─ 將每頁 PNG 縮到 1200px 寬（避免 OOM）
      │   ├─ POST /api/ocr/extract 到 PaddleOCR 微服務（smartledger-paddleocr）
      │   ├─ 以高頻詞過濾廣告水印（出現於 ≥ 60% 頁面的詞彙視為廣告）
      │   └─ 內容過長時只取前 80 頁有意義的頁面送給 LLM
      ├─ 讀取現有 wiki/index.md（讓 LLM 知道已有什麼）
      ├─ 呼叫 LLM（含 ingest system prompt + Tool Use，max_tokens=16000）：
      │    ├─ LLM 讀完內容後，決定要建立哪些頁
      │    ├─ 用 write_page tool 寫入 source_*.md
      │    ├─ 視情況 write_page entity_*.md, concept_*.md
      │    └─ update_index、append_log
      ├─ git commit + push
      └─ 更新 job status = completed
   5. 前端顯示「成功 ingest，已建立 N 頁，點此查看」
```

### 4.2.1 OCR 微服務（PaddleOCR）

掃描版 PDF 的文字層為空或只有浮水印，需要 OCR 才能取得內容。

| 項目 | 說明 |
|---|---|
| 服務 | `smartledger-paddleocr` container（SmartLedger 專案共用） |
| 端口 | host `8001`，docker network 內 `smartledger-paddleocr:8000` |
| API | `POST /api/ocr/extract`，input: image file，output: `{success, texts:[{text, confidence, bbox}]}` |
| 語言模型 | `lang='ch'`，支援繁體中文 |
| 網路 | llm-km backend 加入 `llm-km_default` network，smartledger-paddleocr 也加入同一 network |
| 環境變數 | `OCR_SERVICE_URL=http://smartledger-paddleocr:8000` |

**踩過的坑：**
- 圖片原始尺寸 3000×4056，直接送 OCR 會 OOM（exit 137）→ 縮到 1200px 寬再送
- PaddleOCR `ocr.ocr()` 是同步 blocking，必須用 `asyncio.to_thread` 包裝，否則 uvicorn event loop 卡死
- healthcheck 若用 `python -c "requests.get(...)"` 在 OCR 處理期間會超時導致 container 重啟 → 改用 `curl`

### 4.3 Reflect / Lint / Scan（管理員）

| 操作 | 觸發 | 流程 |
|---|---|---|
| **Scan** | Admin 點按鈕 | 比對 raw/ vs wiki/ frontmatter sources，列出未 ingest 檔案 |
| **Reflect** | Admin 選擇主題 | Claude 跨 wiki 頁合成 `analysis_*.md` |
| **Lint** | Admin 排程或手動 | Claude 檢查矛盾/孤兒/缺連結，產出建議報告 |

## 5. Tool Use 工具定義

```python
TOOLS = [
    {
        "name": "list_pages",
        "description": "列出 wiki 中所有頁面的標題與類型，供概覽用",
        "input_schema": {
            "type": "object",
            "properties": {
                "type_filter": {
                    "type": "string",
                    "enum": ["source", "entity", "concept", "comparison", "analysis"],
                    "description": "選填，只列特定類型"
                }
            }
        }
    },
    {
        "name": "read_page",
        "description": "讀取單一 wiki 頁面的完整 Markdown 內容",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "頁面檔名（不含 .md）"}
            },
            "required": ["name"]
        }
    },
    {
        "name": "search_pages",
        "description": "在所有 wiki 頁面內文中搜尋關鍵字，回傳匹配頁面與片段",
        "input_schema": {
            "type": "object",
            "properties": {
                "keyword": {"type": "string"}
            },
            "required": ["keyword"]
        }
    },
    # Ingest / Reflect 額外工具
    {
        "name": "write_page",
        "description": "建立或更新 wiki 頁面",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "content": {"type": "string", "description": "完整 Markdown 含 frontmatter"}
            },
            "required": ["name", "content"]
        }
    },
    {
        "name": "append_log",
        "description": "附加一筆操作紀錄到 wiki/log.md",
        "input_schema": {
            "type": "object",
            "properties": {
                "entry": {"type": "string"}
            },
            "required": ["entry"]
        }
    },
    {
        "name": "update_index",
        "description": "更新 wiki/index.md（傳入完整新內容）",
        "input_schema": {
            "type": "object",
            "properties": {
                "content": {"type": "string"}
            },
            "required": ["content"]
        }
    }
]
```

## 6. Prompt 設計

### 6.1 Query System Prompt（節錄）

```
你是公司內部知識庫助理。知識庫內容涵蓋：
- 飯店 PMS 系統（Athena）
- 主機轉移 SOP
- 硬體規格建議
- 客戶飯店資料

工作方式：
1. 先用 list_pages 概覽，或從附帶的 index.md 找線索
2. 用 read_page 讀取相關頁面（可多次呼叫）
3. 必要時用 search_pages 擴充檢索
4. 用繁體中文回答，引用頁面以 [[頁名]] 標註
5. 若知識庫沒有答案，明確說「目前知識庫沒有相關資訊」，不要編造

輸出格式：
- 直接回答問題
- 結尾列出引用頁面清單
```

### 6.2 Ingest System Prompt（節錄）

```
你正在 ingest 一份新的來源文件到內部知識庫。請依以下原則：

1. 先讀附帶的 index.md，了解現有頁面結構
2. 為來源建立 source_*.md 摘要頁
3. 識別出現的實體（飯店、廠商、人員）→ 建/更新 entity_*.md
4. 識別出現的概念（SOP、規格、架構）→ 建/更新 concept_*.md
5. 用 [[wiki link]] 交叉引用
6. 圖文並茂：若來源含 PNG（PDF 轉圖），用 ![[圖名]] 嵌入
7. 不要把客戶帳密寫進 wiki，只寫架構/流程
8. 完成後 update_index 與 append_log

命名前綴：source_, entity_, concept_, comparison_, analysis_
所有內容用繁體中文。
```

## 7. 前端互動細節

### 7.1 聊天介面

- 訊息流串流顯示（SSE）
- Tool Use 過程半透明顯示「正在讀取 [[entity_松哖酒店]]...」
- Wiki link 點擊：右側 drawer 預覽該頁，不離開對話
- 引用頁面：訊息底部顯示 chip 列表

### 7.2 Ingest 介面

- 拖拉上傳區（PDF/TXT/MD/最大 50MB）
- 上傳後即時顯示進度條 + 當前步驟文字
- 完成後顯示「已建立 N 頁」+ 直接跳到 browse

### 7.3 Browse 介面

- 左側：樹狀目錄（按類型分組：來源/實體/概念/比較/分析）
- 中央：Markdown 渲染（含 frontmatter 折疊）
- 右側：反向連結 + 標籤
- 工具列：raw 原始檔下載連結（若有）

## 7. 前端設計系統

設計稿位於 `llm-km/`（Claude Design 產出），包含完整 HTML prototype。

### 7.1 Design Token 對應

| 語意別名 | CSS 變數 | 值 |
|---|---|---|
| 品牌主色 | `--color-sf-primary` | `rgb(40, 119, 238)` — #2877EE |
| 深藍 (nav 背景) | `--color-sf-on-primary-container` | `rgb(0, 29, 90)` |
| 成功 | `--color-sf-success` | `rgb(18, 183, 106)` |
| 錯誤 | `--color-sf-error` | `rgb(244, 73, 62)` |
| 警告 | `--color-sf-warning` | `rgb(247, 144, 9)` |
| 主文字 | `--text-primary` | `rgb(15, 23, 42)` |
| 次文字 | `--text-secondary` | `rgb(60, 74, 91)` |
| 邊框預設 | `--border-default` | `rgb(215, 218, 224)` |
| 卡片背景 | `--bg-surface-default` | `rgb(255, 255, 255)` |
| 頁面背景 | `--bg-surface-variant` | `rgb(237, 240, 247)` |

字體：`Noto Sans TC`（中文）+ `Roboto`（英文）+ `JetBrains Mono`（code）

### 7.2 頁面元件清單

| 元件 | 描述 | 設計稿對應 |
|---|---|---|
| `AppHeader` | 60px 頂部列，含 logo / 搜尋 / 用戶 chip | 管理後台.html header |
| `Sidebar` | 248px 左側導航，分組 wiki 頁面 | 管理後台.html sidebar |
| `LoginCard` | 左品牌 + 右表單二欄布局 | 登入.html |
| `WikiRenderer` | Markdown 渲染，含 `[[link]]` 解析 | browse 頁 |
| `ChatPanel` | SSE 串流聊天介面 | 後續 Phase 2 |
| `IngestPanel` | 上傳 + 進度條 | 後續 Phase 2 |

### 7.3 Tailwind 整合方式

CSS Variables 直接在 `globals.css` 宣告，Tailwind 設定使用 `var(--...)` 引用：
```ts
// tailwind.config.ts
colors: {
  primary: 'rgb(var(--color-sf-primary) / <alpha-value>)',
  'on-primary-container': 'rgb(var(--color-sf-on-primary-container) / <alpha-value>)',
  ...
}
```

## 8. 同步與備份

```
┌─────────────────────┐
│  Mac Server /data   │
│      ↕ git          │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐         ┌────────────────────┐
│ GitHub private repo │ ─────►  │ Leon Obsidian Vault│
│ obsidian-wiki       │   pull  │ (個人鏡像)          │
└─────────────────────┘         └────────────────────┘
```

- Mac server 每次寫操作後背景 git commit + push
- 每日凌晨 02:00 整個 /data/ 打包到外部備份盤
- Wiki 衝突解決：以 server 為準（多人寫），個人 Vault 僅供 Leon 個人查閱
