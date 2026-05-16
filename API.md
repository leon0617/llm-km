# REST API 規格

> 後端基底：`https://llm-wiki.example.com/api`

所有端點除 `/auth/login` 外都需要有效 JWT（httpOnly cookie `wiki_token`）。

## 1. 認證 `/api/auth`

### POST `/api/auth/login`
登入。

**Request**
```json
{ "employee_id": "A12345", "password": "***" }
```

**Response 200**
```json
{
  "user": {
    "employee_id": "A12345",
    "name": "Leon Lin",
    "role": "admin",
    "must_change_password": false
  }
}
```
（同時 Set-Cookie: `wiki_token=...; HttpOnly; Secure; SameSite=Lax`）

**Response 401** — 帳密錯誤
**Response 423** — 帳號停用

---

### POST `/api/auth/logout`
登出，清除 cookie。

---

### POST `/api/auth/change-password`
變更密碼（首次登入強制呼叫）。

**Request**
```json
{ "old_password": "***", "new_password": "***" }
```

密碼規則：≥10 字元、含英數、不可與舊密碼相同、不可包含員工編號。

---

### GET `/api/auth/me`
回傳目前登入者資訊。

---

## 2. 查詢 `/api/query`

### POST `/api/query`
送出問題，以 SSE 串流回覆。

**Request**
```json
{
  "question": "松哖酒店轉移時要注意什麼？",
  "session_id": "uuid-or-null"
}
```

**Response** — `text/event-stream`

事件流順序（一次 query 內，多輪 tool use 會重複 provider / tool_use / text）：

```
event: session
data: {"id": "dc8202e9cab34d31"}
  ↑ 開頭一次。新建或接續的 session id（呼叫端要存起來給續輪用）

event: provider
data: {"name": "gemini", "tier": "cheap"}
  ↑ 每輪 LLM 呼叫的第一個事件，回報實際路由到的 provider 與 tier
    若 failover 觸發，會再 yield 一次（換家），前端 badge 應以最後一次為準

event: tool_use
data: {"tool": "read_page", "page": "entity_松哖酒店"}
  ↑ 模型決定呼叫工具，args 因 tool 而異：
    read_page → {"tool": "read_page", "page": "..."}
    search_pages → {"tool": "search_pages", "keyword": "..."}
    list_pages → {"tool": "list_pages"}

event: text
data: {"delta": "松哖酒店在轉移時..."}
  ↑ 串流文字 chunk，多個 delta 串成完整回應

event: usage
data: {"tokens_in": 1002, "tokens_out": 70, "cost_usd": 0.004056,
       "provider": "gemini", "tier": "cheap"}
  ↑ 結尾累計用量與成本估算

event: citations
data: {"pages": ["entity_松哖酒店", "concept_主機轉移SOP"]}
  ↑ 所有讀過的 wiki 頁（含 read_page 與 search_pages 命中的）

event: done
data: {}
  ↑ 結束訊號
```

**錯誤事件**（任何時點都可能出現）
```
event: error
data: {"message": "目前使用者過多，請稍候"}
```

常見錯誤訊息：「沒有可用的 LLM provider」、「超過工具呼叫上限」、「超過回合上限」、provider 串流錯誤等。

---

### GET `/api/query/sessions`
列出當前使用者的對話歷史（最近 50 筆）。

### GET `/api/query/sessions/{id}`
取得單次對話完整內容。

### DELETE `/api/query/sessions/{id}`
刪除指定對話（僅限該使用者本人）。

### GET `/api/query/usage/today`
回傳當前使用者今日 token 用量與成本估算：
```json
{ "tokens_in": 12345, "tokens_out": 678, "cost_usd": 0.0234 }
```

---

## 3. 攝入 `/api/ingest`

### POST `/api/ingest`
上傳文件，建立 ingest job。

**Request** — `multipart/form-data`
- `file` — 檔案（PDF / TXT / MD，最大 50MB）
- `note` — 選填，使用者備註

**Response 202**
```json
{
  "job_id": "ingest_20260504_abc123",
  "status_url": "/api/jobs/ingest_20260504_abc123"
}
```

**Response 413** — 檔案過大
**Response 415** — 不支援的格式

---

### GET `/api/jobs/{job_id}`
查詢 job 狀態。

**Response 200**
```json
{
  "id": "ingest_20260504_abc123",
  "type": "ingest",
  "status": "running",
  "progress": 0.6,
  "step": "正在產出 wiki 頁面",
  "logs": ["已轉檔 15 張 PNG", "正在呼叫 Claude API"],
  "input": {
    "filename": "20260331_中科后豐_轉移前置測試評估.pdf",
    "uploader": "A12345"
  },
  "output": {
    "pages_created": ["source_中科后豐評估.md", "entity_中科后豐會館.md"],
    "pages_updated": ["wiki/index.md"]
  },
  "created_at": "2026-05-04T10:00:00+08:00",
  "completed_at": null,
  "error": null
}
```

`status` 值：`queued` | `running` | `completed` | `failed`

---

### GET `/api/jobs`
列出當前使用者的 job 歷史（管理員可看全部，需加 `?all=true`）。

---

## 4. Wiki 瀏覽 `/api/wiki`

### GET `/api/wiki/tree`
回傳 wiki 樹狀結構，前端用於左側導航。

**Response 200**
```json
{
  "groups": [
    {
      "type": "source",
      "label": "來源摘要",
      "pages": [
        { "name": "source_中科后豐評估", "title": "中科后豐評估", "updated": "2026-04-08" }
      ]
    },
    { "type": "entity", "label": "實體", "pages": [...] },
    { "type": "concept", "label": "概念", "pages": [...] },
    { "type": "comparison", "label": "比較", "pages": [...] },
    { "type": "analysis", "label": "分析", "pages": [...] }
  ],
  "special": [
    { "name": "index", "title": "索引" },
    { "name": "log", "title": "操作日誌" },
    { "name": "questions", "title": "開放問題" }
  ]
}
```

---

### GET `/api/wiki/page/{name}`
取得單頁內容。

**Response 200**
```json
{
  "name": "entity_松哖酒店",
  "frontmatter": {
    "title": "松哖酒店",
    "type": "entity",
    "sources": ["20220713_松哖_sonnie_轉移前置測試評估.txt"],
    "created": "2026-04-08",
    "updated": "2026-04-08",
    "tags": ["飯店客戶", "轉移", "2022"]
  },
  "body_markdown": "# 松哖酒店\n\n...",
  "backlinks": [
    { "name": "comparison_四間飯店轉移比較", "title": "四間飯店轉移比較" }
  ],
  "raw_files": [
    { "name": "20220713_松哖_sonnie_轉移前置測試評估.txt", "url": "/api/raw/20220713_松哖_sonnie_轉移前置測試評估.txt" }
  ]
}
```

**Response 404** — 頁面不存在

---

### GET `/api/wiki/search?q=keyword`
全文搜尋（簡單 grep，非 LLM 查詢）。

**Response 200**
```json
{
  "matches": [
    {
      "name": "entity_松哖酒店",
      "title": "松哖酒店",
      "snippet": "...有<mark>自助機</mark>，移機時需自助機人員支援..."
    }
  ]
}
```

---

### GET `/api/raw/{filename}`
下載原始檔案（PDF/TXT/MD/PNG）。

**權限**：員工以上。
**Response**：原檔，附 Content-Disposition。

---

## 5. 管理員 `/api/admin`

所有端點需 `role=admin`。

### POST `/api/admin/users/import`
CSV 批次匯入帳號。

**Request** — `multipart/form-data`
- `file` — CSV 檔，欄位：`employee_id, email, name, role, default_password`

**Response 200**
```json
{
  "created": 58,
  "skipped": 2,
  "errors": [
    { "row": 12, "reason": "employee_id 已存在" }
  ]
}
```

---

### GET `/api/admin/users`
列出所有帳號。

### PATCH `/api/admin/users/{employee_id}`
修改帳號（停用、改 role、重設密碼）。

```json
{
  "active": false,
  "role": "employee",
  "reset_password": true
}
```

---

### POST `/api/admin/operations/scan`
觸發 Scan，列出 raw 中未 ingest 的檔案。

**Response 200**
```json
{
  "unprocessed": [
    "20260501_新案場_評估.txt",
    "硬體規格_2026Q2.pdf"
  ]
}
```

---

### POST `/api/admin/operations/reflect`
觸發 Reflect。

**Request**
```json
{
  "topic": "飯店轉移時程因子",
  "scope_pages": ["entity_*", "concept_主機轉移SOP"]
}
```

**Response 202** — 同 ingest，回 `job_id`，背景跑。

---

### POST `/api/admin/operations/lint`
觸發 Lint，產出健檢報告。

**Response 202** — 回 `job_id`。完成後 output 內容：

```json
{
  "issues": [
    {
      "type": "orphan",
      "page": "entity_某飯店",
      "message": "沒有任何頁面連結到此頁"
    },
    {
      "type": "broken_link",
      "page": "concept_X",
      "target": "[[concept_Y]]",
      "message": "目標頁不存在"
    },
    {
      "type": "missing_concept",
      "term": "RocketMQ",
      "mentioned_in": ["entity_老爺林森會館"],
      "message": "被多次提及但無獨立頁面"
    }
  ]
}
```

---

### GET `/api/admin/audit`
查詢操作日誌。

**Query params**
- `employee_id` — 篩選使用者
- `action` — 篩選操作類型
- `from`, `to` — 時間區間（ISO）
- `page`, `page_size` — 分頁

---

### GET `/api/admin/usage`
全站 token 用量與成本統計。

**Query params**
- `days` — 統計天數（預設 30）

**Response**
```json
{
  "days": 30,
  "total": {"tokens_in": 1234567, "tokens_out": 45678, "messages": 234, "cost_usd": 4.56},
  "by_user": [{"username": "...", "tokens_in": ..., "tokens_out": ..., "messages": ..., "cost_usd": ...}],
  "by_day": [{"day": "2026-05-12", "tokens_in": ..., "tokens_out": ..., "messages": ..., "cost_usd": ...}],
  "pricing": {"input_per_m_usd": 3, "output_per_m_usd": 15}
}
```

---

### GET `/api/admin/llm/queue`
LLM router 即時狀態。前端 admin 用量頁每 5 秒輪詢一次。

**Response**
```json
{
  "providers": [
    {
      "name": "anthropic",
      "model": "claude-sonnet-4-6",
      "tier": "premium",
      "weight": 1,
      "max_concurrent": 6,
      "in_use": 2,
      "waiting": 0,
      "fail_count": 0,
      "healthy": true
    },
    {
      "name": "gemini",
      "model": "gemini-flash-latest",
      "tier": "cheap",
      "weight": 2,
      "max_concurrent": 6,
      "in_use": 0,
      "waiting": 0,
      "fail_count": 3,
      "healthy": true
    }
  ],
  "total_max_concurrent": 12,
  "total_in_use": 2,
  "total_waiting": 0,
  "routing": "round-robin"
}
```

`fail_count` 累計失敗次數（含 failover 觸發的）；成功一次後歸零。`healthy` 反映 provider 自身的健康檢查（API key + model 設定）。

---

## 6. 錯誤格式

所有錯誤統一格式：

```json
{
  "error": {
    "code": "validation_error",
    "message": "密碼不可包含員工編號",
    "field": "new_password"
  }
}
```

| HTTP | code | 說明 |
|---|---|---|
| 400 | validation_error | 輸入格式錯誤 |
| 401 | unauthorized | 未登入或 token 失效 |
| 403 | forbidden | 權限不足 |
| 404 | not_found | 資源不存在 |
| 409 | conflict | 衝突（如 employee_id 已存在） |
| 413 | payload_too_large | 檔案過大 |
| 415 | unsupported_media | 格式不支援 |
| 423 | account_locked | 帳號停用 |
| 429 | rate_limit | 超出 API 速率 |
| 500 | internal_error | 後端錯誤 |
| 503 | upstream_error | Anthropic API 異常 |

## 7. Rate Limiting

| 端點 | 限制 |
|---|---|
| `/auth/login` | 5 次 / 分鐘 / IP |
| `/query` | 30 次 / 分鐘 / 使用者 |
| `/ingest` | 5 次 / 小時 / 使用者 |
| `/admin/operations/*` | 10 次 / 小時 / 系統 |

超出回 429。
