from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel

from app.storage import wiki_fs
from app.storage import audit
from app.auth.deps import get_current_user, require_editor, require_admin

router = APIRouter(prefix="/wiki", tags=["wiki"])


class UpdatePageRequest(BaseModel):
    content: str  # full markdown with optional YAML frontmatter


def _meta(request: Request) -> tuple[str, str]:
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "")
    if "," in ip:
        ip = ip.split(",")[0].strip()
    return ip, request.headers.get("user-agent", "")


@router.get("/tree")
async def get_tree(_: dict = Depends(get_current_user)):
    return wiki_fs.build_tree()


@router.get("/page/{name:path}")
async def get_page(name: str, _: dict = Depends(get_current_user)):
    page = await wiki_fs.read_page(name)
    if page is None:
        raise HTTPException(status_code=404, detail="頁面不存在")
    return page


@router.put("/page/{name:path}")
async def update_page(
    name: str,
    body: UpdatePageRequest,
    request: Request,
    current: dict = Depends(require_editor),
):
    """Edit (or create) a wiki page. editor + admin only."""
    ip, ua = _meta(request)
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="頁面內容不可為空")
    existed = (await wiki_fs.read_page(name)) is not None
    try:
        await wiki_fs.write_page(name, body.content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    audit.log(
        "wiki.page_update" if existed else "wiki.page_create",
        actor=current["username"], target=name,
        ip=ip, user_agent=ua,
        details={"size": len(body.content)},
    )
    return {"ok": True, "created": not existed}


@router.delete("/page/{name:path}")
async def delete_page(
    name: str,
    request: Request,
    current: dict = Depends(require_admin),
):
    """Delete a wiki page. admin only — irreversible."""
    ip, ua = _meta(request)
    # Reject protected pages
    if name in {"index", "log"}:
        raise HTTPException(status_code=400, detail=f"`{name}` 為系統保留頁面，不能刪除")

    try:
        ok = wiki_fs.delete_page(name)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"刪除失敗：{e}")
    if not ok:
        raise HTTPException(status_code=404, detail="頁面不存在")

    audit.log(
        "wiki.page_delete",
        actor=current["username"], target=name,
        ip=ip, user_agent=ua,
    )
    return {"ok": True}


@router.get("/search")
async def search(q: str, _: dict = Depends(get_current_user)):
    if not q or len(q) < 2:
        return {"matches": []}
    return {"matches": wiki_fs.search_pages(q)}


@router.get("/pages")
async def list_pages(_: dict = Depends(get_current_user)):
    return {"pages": wiki_fs.list_pages()}
