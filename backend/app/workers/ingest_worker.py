import asyncio
import httpx
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings
from app.llm import prompts, tools
from app.llm.client import complete as llm_complete
from app.llm.pdf import pdf_to_png
from app.llm.office import convert_to_pdf, OFFICE_EXTENSIONS
from app.storage import jobs as job_store
from app.storage import wiki_fs
from app.storage import audit


async def _ocr_container_start() -> None:
    if not settings.ocr_container_name or not settings.ocr_service_url:
        return
    try:
        import docker as docker_sdk
        client = await asyncio.to_thread(docker_sdk.from_env)
        container = await asyncio.to_thread(client.containers.get, settings.ocr_container_name)
        if container.status != "running":
            await asyncio.to_thread(container.start)
        async with httpx.AsyncClient(timeout=5) as hc:
            for _ in range(60):
                await asyncio.sleep(3)
                try:
                    r = await hc.get(f"{settings.ocr_service_url}/health")
                    if r.status_code == 200:
                        return
                except Exception:
                    pass
    except Exception:
        pass


async def _ocr_container_stop() -> None:
    if not settings.ocr_container_name:
        return
    try:
        import docker as docker_sdk
        client = await asyncio.to_thread(docker_sdk.from_env)
        container = await asyncio.to_thread(client.containers.get, settings.ocr_container_name)
        await asyncio.to_thread(container.stop)
    except Exception:
        pass


async def _ocr_png(png_path: Path) -> str:
    if not settings.ocr_service_url:
        return ""

    def _resize_and_encode(path: Path) -> bytes:
        import fitz
        doc = fitz.open(str(path))
        page = doc[0]
        orig_w = page.rect.width
        scale = min(1.0, 1200 / orig_w) if orig_w > 0 else 1.0
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat)
        return pix.tobytes("png")

    img_bytes = await asyncio.to_thread(_resize_and_encode, png_path)
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{settings.ocr_service_url}/api/ocr/extract",
            files={"file": (png_path.name, img_bytes, "image/png")},
        )
    if resp.status_code != 200:
        return ""
    data = resp.json()
    return " ".join(t["text"] for t in data.get("texts", []))


async def run_ingest(job_id: str, file_path: Path, filename: str) -> None:
    def log(msg: str) -> None:
        job_store.append_log(job_id, msg)

    try:
        job_store.update_job(job_id, status="running", step="準備中", progress=0.05)
        log(f"開始處理：{filename}")

        suffix = Path(filename).suffix.lower()
        # ── 1. Normalise Office docs → PDF first ────────────────────────────
        # After this block, `pdf_path` is set iff we have a PDF (original or converted).
        # `display_name` is used in wiki frontmatter / image base names.
        pdf_path: Path | None = None
        display_name = filename

        if suffix == ".pdf":
            pdf_path = file_path
        elif suffix in OFFICE_EXTENSIONS:
            job_store.update_job(job_id, step="Office 文件轉 PDF 中", progress=0.10)
            log(f"使用 LibreOffice 轉檔（{suffix}）…")
            pdf_path = await convert_to_pdf(file_path, file_path.parent)
            log(f"轉檔完成：{pdf_path.name}")

        # ── 2. PDF → PNG（用原檔名為 base，保持與 frontmatter 的 sources 一致） ─
        png_names: list[str] = []
        if pdf_path is not None:
            job_store.update_job(job_id, step="PDF 轉圖中", progress=0.20)
            base = Path(filename).stem  # use ORIGINAL filename stem (not pdf_path.stem)
            png_names = await asyncio.to_thread(
                pdf_to_png, pdf_path, settings.raw_dir / "assets", base,
            )
            log(f"PDF 轉圖完成：{len(png_names)} 頁")

        # ── 3. Extract text content ────────────────────────────────────────
        job_store.update_job(job_id, step="讀取來源內容", progress=0.30)
        page_texts: list[str] = []
        if pdf_path is not None:
            import fitz
            doc = fitz.open(str(pdf_path))
            page_texts = [page.get_text() for page in doc]
            doc.close()

            total_chars = sum(len(t.strip()) for t in page_texts)
            unique_pages = len(set(t.strip() for t in page_texts if t.strip()))
            is_scanned = (total_chars < 100) or (
                unique_pages <= 2 and len(page_texts) > 5
            )
            if is_scanned and png_names and settings.ocr_service_url:
                log(f"PDF 文字層幾乎為空或重複（總字數 {total_chars}，唯一頁數 {unique_pages}），啟用 OCR 辨識…")
                job_store.update_job(job_id, step="啟動 OCR 服務", progress=0.33)
                await _ocr_container_start()
                log("OCR 服務已就緒")
                job_store.update_job(job_id, step="OCR 辨識中", progress=0.35)
                assets_dir = settings.raw_dir / "assets"
                ocr_texts: list[str] = []
                try:
                    for i, png_name in enumerate(png_names):
                        png_path_ocr = assets_dir / png_name
                        text = await _ocr_png(png_path_ocr)
                        ocr_texts.append(text)
                        if (i + 1) % 10 == 0:
                            log(f"OCR 進度：{i+1}/{len(png_names)} 頁")
                finally:
                    log("停止 OCR 服務以釋放記憶體")
                    await _ocr_container_stop()
                page_texts = ocr_texts
                log(f"OCR 完成：共 {len(page_texts)} 頁")

                from collections import Counter
                segment_freq: Counter = Counter()
                for t in page_texts:
                    for seg in t.split():
                        segment_freq[seg] += 1
                spam_threshold = len(page_texts) * 0.6
                spam_words = {w for w, c in segment_freq.items() if c >= spam_threshold and len(w) > 1}

                cleaned: list[str] = []
                for t in page_texts:
                    filtered = " ".join(w for w in t.split() if w not in spam_words)
                    cleaned.append(filtered.strip())
                page_texts = cleaned
                log(f"廣告過濾完成，有效頁數：{sum(1 for t in page_texts if len(t) > 20)}")

            source_text = "\n\n".join(
                f"[第 {i+1} 頁]\n{t}" for i, t in enumerate(page_texts) if t.strip()
            )
            if len(source_text) > 40000:
                meaningful = [(i, t) for i, t in enumerate(page_texts) if len(t.strip()) > 50]
                sampled = meaningful[:80]
                source_text = "\n\n".join(f"[第 {i+1} 頁]\n{t}" for i, t in sampled)
                log(f"內容過長，取前 {len(sampled)} 頁有效內容（共 {len(meaningful)} 頁有文字）")
        else:
            source_text = file_path.read_text(encoding="utf-8", errors="replace")

        # Build PNG↔page mapping table for LLM (only when we have both PNG and text)
        png_page_table = ""
        if png_names and page_texts:
            stem = Path(filename).stem
            rows = []
            for i, (png, txt) in enumerate(zip(png_names, page_texts)):
                preview = txt.strip().replace("\n", " ")[:60]
                rows.append(f"  - {png}（第{i+1}頁）：{preview}")
            png_page_table = "\n**PNG 頁碼對應表**（每行格式：PNG檔名 → 該頁摘要）：\n" + "\n".join(rows)

        # Read existing index
        index_page = await wiki_fs.read_page("index")
        index_content = index_page["body_markdown"] if index_page else "（無索引）"

        # Prepare messages
        today = datetime.now().strftime("%Y-%m-%d")
        user_content = f"""請 ingest 以下來源文件：

**原始檔名（必須一字不差用於 frontmatter sources）**：`{filename}`
**日期**：{today}
{png_page_table}

⚠️ 重要規則：
1. 所有新建頁面的 frontmatter `sources:` 欄位**必須**完整使用上面的原始檔名 `{filename}`，**不可**：
   - 移除或修改底線、空白、標點
   - 改變副檔名（例如 .pdf 不可改為 .docx）
   - 翻譯或縮寫檔名
2. 若原始檔名含特殊字元，照樣保留（YAML 用引號包起來）
3. 每個 concept_/entity_ 頁面，根據上方「PNG 頁碼對應表」找出內容相符的 PNG，在頁面末尾加「## 原始教學圖」嵌入；source_ 頁面末尾加「## 原始頁面掃描」嵌入全部 PNG

---
**現有 wiki/index.md 內容**：
{index_content}

---
**來源文件內容**：
{source_text}"""

        job_store.update_job(job_id, step="LLM 分析中", progress=0.40)
        log("呼叫 LLM")

        messages = [{"role": "user", "content": user_content}]
        pages_created: list[str] = []

        MAX_TURNS = 20
        MAX_TOOL_CALLS = 60
        tool_calls = 0
        pinned_provider: str | None = None  # pin after turn 1 (provider-specific raw msg)

        for turn in range(MAX_TURNS):
            final = await llm_complete(
                system=prompts.INGEST_SYSTEM,
                messages=messages,
                tools=tools.INGEST_TOOLS,
                max_tokens=16000,
                tier=settings.route_ingest,
                force_provider=pinned_provider,
            )
            if pinned_provider is None and final.provider_name:
                pinned_provider = final.provider_name
            messages.append({"role": "assistant", "raw": final.raw_assistant_message})

            log(f"turn {turn}: stop_reason={final.stop_reason}, tools={[tc.name for tc in final.tool_calls]}")
            if final.stop_reason == "end_turn":
                log(f"LLM end_turn（turn={turn}，已建頁={pages_created}，text長度={len(str(final.raw_assistant_message)[:200])}）")
                if not pages_created and turn == 0:
                    log("LLM 未呼叫 write_page，補發強制提示")
                    messages.append({
                        "role": "user",
                        "content": (
                            "⚠️ 你尚未呼叫任何 write_page。"
                            "根據規則，你**必須**至少建立一個 source_*.md 頁面。"
                            "請立即執行 write_page 建立來源頁面，不可直接結束。"
                        ),
                    })
                    continue  # retry
                break
            if final.stop_reason != "tool_use":
                break

            tool_results = []
            for tc in final.tool_calls:
                tool_calls += 1
                if tool_calls > MAX_TOOL_CALLS:
                    raise RuntimeError(f"超過工具呼叫上限（{MAX_TOOL_CALLS}），已中止")

                log(f"工具呼叫：{tc.name}({list(tc.input.keys())})")
                result = await tools.execute_tool(tc.name, tc.input)
                if tc.name == "write_page":
                    pname = tc.input.get("name") or "<unknown>"
                    pages_created.append(pname)
                    job_store.update_job(job_id, step=f"寫入 {pname}.md", progress=0.70)
                tool_results.append({"id": tc.id, "name": tc.name, "content": result})

            messages.append({"role": "user", "tool_results": tool_results})
        else:
            raise RuntimeError(f"超過回合上限（{MAX_TURNS}），已中止")

        job_store.update_job(
            job_id,
            status="completed",
            step="完成",
            progress=1.0,
            completed_at=datetime.now(timezone.utc).isoformat(),
            output={"pages_created": pages_created, "png_files": png_names},
        )
        log(f"完成。建立頁面：{pages_created}")

        # Audit: ingest finished
        job = job_store.get_job(job_id) or {}
        actor = (job.get("input") or {}).get("actor")
        audit.log("ingest.complete", actor=actor, target=filename,
                  details={"job_id": job_id, "pages_created": pages_created,
                           "png_count": len(png_names)})

    except Exception as e:
        job_store.update_job(
            job_id,
            status="failed",
            step="失敗",
            completed_at=datetime.now(timezone.utc).isoformat(),
            error=str(e),
        )
        job_store.append_log(job_id, f"ERROR: {e}")

        job = job_store.get_job(job_id) or {}
        actor = (job.get("input") or {}).get("actor")
        audit.log("ingest.fail", actor=actor, target=filename, outcome="failure",
                  details={"job_id": job_id, "error": str(e)})
        raise
