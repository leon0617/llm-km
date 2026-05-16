import asyncio
import shutil
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks, Depends, Request
from pydantic import BaseModel
from app.auth.deps import get_current_user, require_editor

from app.config import settings
from app.storage import jobs as job_store
from app.storage import audit
from app.workers.ingest_worker import run_ingest

router = APIRouter(prefix="/ingest", tags=["ingest"])

ALLOWED_EXT = {
    ".pdf", ".txt", ".md",
    # Office (transparently converted to PDF on ingest)
    ".docx", ".xlsx", ".pptx",
    ".doc", ".xls", ".ppt",
    ".odt", ".ods", ".odp",
    ".rtf",
}
MAX_BYTES = 50 * 1024 * 1024  # 50MB


@router.post("")
async def start_ingest(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    note: str = Form(default=""),
    current: dict = Depends(require_editor),
):
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "")
    if "," in ip:
        ip = ip.split(",")[0].strip()
    ua = request.headers.get("user-agent", "")

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXT:
        audit.log("ingest.start", actor=current["username"], outcome="failure",
                  ip=ip, user_agent=ua,
                  details={"filename": file.filename, "reason": "unsupported_format"})
        raise HTTPException(status_code=415, detail=f"不支援的格式：{suffix}，接受 PDF / TXT / MD")

    # Save to raw/
    month_dir = settings.raw_dir / datetime.now().strftime("%Y%m")
    month_dir.mkdir(parents=True, exist_ok=True)
    dest = month_dir / (file.filename or "upload")

    size = 0
    with open(dest, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                dest.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="檔案超過 50MB 限制")
            f.write(chunk)

    job_id = job_store.create_job("ingest", {
        "filename": file.filename,
        "note": note,
        "path": str(dest),
        "actor": current["username"],
    })

    audit.log("ingest.start", actor=current["username"], target=file.filename,
              ip=ip, user_agent=ua,
              details={"job_id": job_id, "size": size, "note": note})

    background_tasks.add_task(run_ingest, job_id, dest, file.filename or "upload")

    return {"job_id": job_id, "status_url": f"/api/jobs/{job_id}"}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = job_store.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job 不存在")
    return job


class ReprocessRequest(BaseModel):
    path: str  # path relative to raw_dir, e.g. "202605/Mac_加入ad的步驟.pdf"


@router.post("/reprocess")
async def reprocess(
    body: ReprocessRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    current: dict = Depends(require_editor),
):
    """Re-ingest an existing raw file. Existing wiki pages with the same names
    will be overwritten by Claude."""
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "")
    if "," in ip:
        ip = ip.split(",")[0].strip()
    ua = request.headers.get("user-agent", "")

    raw_root = settings.raw_dir.resolve()
    target = (raw_root / body.path).resolve()
    # Path traversal guard
    try:
        target.relative_to(raw_root)
    except ValueError:
        raise HTTPException(status_code=400, detail="無效的路徑")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="檔案不存在")

    filename = target.name
    job_id = job_store.create_job("ingest", {
        "filename": filename,
        "note": "重新 ingest",
        "path": str(target),
        "actor": current["username"],
        "reprocess": True,
    })

    audit.log("ingest.reprocess", actor=current["username"], target=filename,
              ip=ip, user_agent=ua, details={"job_id": job_id, "path": body.path})

    background_tasks.add_task(run_ingest, job_id, target, filename)
    return {"job_id": job_id, "status_url": f"/api/jobs/{job_id}"}
