import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.config import settings

_lock = threading.Lock()


def _job_path(job_id: str) -> Path:
    settings.jobs_dir.mkdir(parents=True, exist_ok=True)
    return settings.jobs_dir / f"{job_id}.json"


def _atomic_write(path: Path, data: dict) -> None:
    """Write JSON atomically so concurrent readers never see a partial file."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def create_job(job_type: str, input_data: dict) -> str:
    job_id = f"{job_type}_{datetime.now().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:6]}"
    data = {
        "id": job_id,
        "type": job_type,
        "status": "queued",
        "progress": 0.0,
        "step": "排隊中",
        "logs": [],
        "input": input_data,
        "output": {},
        "created_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": None,
        "error": None,
    }
    with _lock:
        _atomic_write(_job_path(job_id), data)
    return job_id


def get_job(job_id: str) -> Optional[dict]:
    p = _job_path(job_id)
    if not p.exists():
        return None
    with _lock:
        return json.loads(p.read_text(encoding="utf-8"))


def update_job(job_id: str, **kwargs) -> None:
    p = _job_path(job_id)
    with _lock:
        data = json.loads(p.read_text(encoding="utf-8"))
        data.update(kwargs)
        _atomic_write(p, data)


def append_log(job_id: str, msg: str) -> None:
    p = _job_path(job_id)
    with _lock:
        data = json.loads(p.read_text(encoding="utf-8"))
        data["logs"].append(msg)
        _atomic_write(p, data)
