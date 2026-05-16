"""Office document → PDF conversion via headless LibreOffice.

Used by the ingest worker so Office docs can flow through the existing
PDF → PNG → ingest pipeline. Image content is preserved.
"""
from __future__ import annotations
import asyncio
import shutil
from pathlib import Path

OFFICE_EXTENSIONS = {
    # Modern (Open XML)
    ".docx", ".xlsx", ".pptx",
    # Legacy binary
    ".doc", ".xls", ".ppt",
    # Other LibreOffice-readable
    ".odt", ".ods", ".odp",
    ".rtf",
}

# Conversions can take a while for large decks; budget generously.
CONVERT_TIMEOUT_SEC = 180


async def convert_to_pdf(src: Path, out_dir: Path) -> Path:
    """Convert an Office document to PDF in `out_dir`. Returns the PDF path.

    Runs LibreOffice headless as a subprocess. Raises RuntimeError on
    timeout or failure.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    expected_pdf = out_dir / (src.stem + ".pdf")

    # If a previous run produced this PDF, remove it so we don't return stale data
    if expected_pdf.exists():
        expected_pdf.unlink()

    cmd = [
        "soffice",
        "--headless",
        "--nologo",
        "--nofirststartwizard",
        "--convert-to", "pdf",
        "--outdir", str(out_dir),
        str(src),
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={"HOME": "/tmp", "PATH": "/usr/bin:/bin"},
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=CONVERT_TIMEOUT_SEC)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise RuntimeError(f"LibreOffice 轉檔超過 {CONVERT_TIMEOUT_SEC}s，已中止")
    except FileNotFoundError:
        raise RuntimeError("找不到 soffice，請確認 LibreOffice 已安裝於容器中")

    if proc.returncode != 0:
        err = (stderr or b"").decode(errors="replace")[:500]
        raise RuntimeError(f"LibreOffice 轉檔失敗（exit {proc.returncode}）：{err}")

    if not expected_pdf.exists():
        # LibreOffice may name the output slightly differently for some inputs
        candidates = list(out_dir.glob(f"{src.stem}.pdf"))
        if not candidates:
            raise RuntimeError("LibreOffice 未產出 PDF 檔")
        expected_pdf = candidates[0]

    return expected_pdf


def soffice_available() -> bool:
    return shutil.which("soffice") is not None
