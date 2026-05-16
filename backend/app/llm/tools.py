from app.storage import wiki_fs

QUERY_TOOLS = [
    {
        "name": "list_pages",
        "description": "列出 wiki 中所有頁面的標題與類型",
        "input_schema": {
            "type": "object",
            "properties": {
                "type_filter": {
                    "type": "string",
                    "enum": ["source", "entity", "concept", "comparison", "analysis"],
                    "description": "只列特定類型（選填）"
                }
            }
        }
    },
    {
        "name": "read_page",
        "description": "讀取單一 wiki 頁面的完整內容",
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
        "description": "在所有 wiki 頁面中搜尋關鍵字",
        "input_schema": {
            "type": "object",
            "properties": {
                "keyword": {"type": "string"}
            },
            "required": ["keyword"]
        }
    }
]

# Lint can only read — no write capability whatsoever
LINT_TOOLS = QUERY_TOOLS + [
    {
        "name": "append_log",
        "description": "附加操作紀錄到 wiki/log.md（只能寫 log，不能改其他頁）",
        "input_schema": {
            "type": "object",
            "properties": {
                "entry": {"type": "string"},
            },
            "required": ["entry"],
        },
    }
]


INGEST_TOOLS = QUERY_TOOLS + [
    {
        "name": "write_page",
        "description": "建立或更新 wiki 頁面（傳入完整 Markdown 含 frontmatter）",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "頁面檔名（不含 .md），例如 entity_松哖酒店"},
                "content": {"type": "string", "description": "完整 Markdown 含 YAML frontmatter"}
            },
            "required": ["name", "content"]
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
    },
    {
        "name": "append_log",
        "description": "附加操作紀錄到 wiki/log.md",
        "input_schema": {
            "type": "object",
            "properties": {
                "entry": {"type": "string", "description": "Markdown 格式的日誌條目"}
            },
            "required": ["entry"]
        }
    }
]


async def execute_tool(name: str, inputs: dict) -> str:
    """Execute a tool call and return result as string.

    All exceptions are caught and returned as text so the agent can see and
    recover (e.g. retry with corrected input).
    """
    try:
        if name == "list_pages":
            pages = wiki_fs.list_pages()
            type_filter = inputs.get("type_filter")
            if type_filter:
                pages = [p for p in pages if p["type"] == type_filter]
            lines = [f"- {p['name']}: {p['title']} ({p['type']})" for p in pages]
            return "\n".join(lines) or "（無頁面）"

        elif name == "read_page":
            page_name = inputs.get("name")
            if not page_name:
                return "錯誤：read_page 缺少 name 參數"
            page = await wiki_fs.read_page(page_name)
            if page is None:
                return f"找不到頁面：{page_name}"
            fm = page["frontmatter"]
            header = f"---\ntitle: {fm.get('title', '')}\ntype: {fm.get('type', '')}\n---\n\n"
            import re
            body = re.sub(
                r'!\[\[([^\]]+\.png)\]\]',
                lambda m: f"![{m.group(1)}](/api/raw/assets/{m.group(1)})",
                page["body_markdown"],
            )
            return header + body

        elif name == "search_pages":
            keyword = inputs.get("keyword")
            if not keyword:
                return "錯誤：search_pages 缺少 keyword 參數"
            results = wiki_fs.search_pages(keyword)
            if not results:
                return "沒有找到相關頁面"
            return "\n".join([f"- {r['name']}: ...{r['snippet']}..." for r in results])

        elif name == "write_page":
            page_name = inputs.get("name")
            content = inputs.get("content")
            if not page_name or content is None:
                return "錯誤：write_page 需要 name 和 content"
            await wiki_fs.write_page(page_name, content)
            return f"已寫入：{page_name}.md"

        elif name == "update_index":
            content = inputs.get("content")
            if content is None:
                return "錯誤：update_index 需要 content"
            await wiki_fs.write_page("index", content)
            return "index.md 已更新"

        elif name == "append_log":
            entry = inputs.get("entry")
            if not entry:
                return "錯誤：append_log 需要 entry"
            import aiofiles
            from app.config import settings
            log_path = settings.wiki_dir / "log.md"
            async with aiofiles.open(log_path, "a", encoding="utf-8") as f:
                await f.write(f"\n{entry}\n")
            return "log.md 已附加"

        return f"未知工具：{name}"

    except Exception as e:
        return f"工具執行失敗（{name}）：{type(e).__name__}: {e}"
