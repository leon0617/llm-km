from fastapi import APIRouter, HTTPException, Depends, Request, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
from app.auth.deps import get_current_user
from app.auth.password import hash_password
from app.storage import users as user_store
from app.storage import audit
from app.storage import jobs as job_store
from app.storage import sessions as session_store
from app.workers.scan_worker import scan as run_scan
from app.workers.reflect_worker import run_reflect
from app.workers.lint_worker import run_lint

router = APIRouter(prefix="/api/admin", tags=["admin"])


def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="需要管理員權限")
    return current_user


def _meta(request: Request) -> tuple[str, str]:
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "")
    if "," in ip:
        ip = ip.split(",")[0].strip()
    return ip, request.headers.get("user-agent", "")


class CreateUserRequest(BaseModel):
    username: str
    password: str = ""           # ignored when auth_source = "ad"
    role: str = "user"
    display_name: str = ""
    auth_source: str = "local"   # "local" | "ad"
    employee_id: str = ""
    email: str = ""


class UpdateProfileRequest(BaseModel):
    employee_id: str | None = None
    email: str | None = None
    display_name: str | None = None


class ResetPasswordRequest(BaseModel):
    new_password: str


class UpdateRoleRequest(BaseModel):
    role: str


@router.get("/users")
async def list_users(_: dict = Depends(require_admin)):
    return user_store.list_users()


@router.post("/users")
async def create_user(body: CreateUserRequest, request: Request, current: dict = Depends(require_admin)):
    ip, ua = _meta(request)
    if body.role not in ("admin", "editor", "user"):
        raise HTTPException(status_code=400, detail="role 只能是 admin / editor / user")
    if body.auth_source not in ("local", "ad"):
        raise HTTPException(status_code=400, detail="auth_source 只能是 local / ad")

    if body.auth_source == "local":
        if len(body.password) < 8:
            raise HTTPException(status_code=400, detail="密碼至少需要 8 個字元")
        password_hash = hash_password(body.password)
    else:
        # AD account: no local password — login goes through LDAP bind
        from app.auth import ldap_auth
        if not ldap_auth.is_enabled():
            raise HTTPException(
                status_code=400,
                detail="AD 認證目前未啟用（請在 .env 設定 AD_ENABLED=true 與相關欄位）",
            )
        password_hash = ""

    try:
        user = user_store.create_user(
            username=body.username,
            password_hash=password_hash,
            role=body.role,
            display_name=body.display_name,
            must_change_password=(body.auth_source == "local"),
            auth_source=body.auth_source,
            employee_id=body.employee_id,
            email=body.email,
        )
        audit.log("admin.user_create", actor=current["username"], target=body.username,
                  ip=ip, user_agent=ua,
                  details={"role": body.role, "auth_source": body.auth_source,
                           "display_name": body.display_name,
                           "employee_id": body.employee_id,
                           "email": body.email})
        return {k: v for k, v in user.items() if k != "password_hash"}
    except ValueError as e:
        audit.log("admin.user_create", actor=current["username"], target=body.username,
                  outcome="failure", ip=ip, user_agent=ua, details={"reason": str(e)})
        raise HTTPException(status_code=409, detail=str(e))


@router.delete("/users/{username}")
async def delete_user(username: str, request: Request, current: dict = Depends(require_admin)):
    ip, ua = _meta(request)
    if username == current["username"]:
        raise HTTPException(status_code=400, detail="不能刪除自己")
    user_store.delete_user(username)
    audit.log("admin.user_delete", actor=current["username"], target=username, ip=ip, user_agent=ua)
    return {"ok": True}


@router.post("/users/{username}/activate")
async def activate_user(username: str, request: Request, current: dict = Depends(require_admin)):
    ip, ua = _meta(request)
    user_store.set_active(username, True)
    audit.log("admin.user_activate", actor=current["username"], target=username, ip=ip, user_agent=ua)
    return {"ok": True}


@router.post("/users/{username}/deactivate")
async def deactivate_user(username: str, request: Request, current: dict = Depends(require_admin)):
    ip, ua = _meta(request)
    if username == current["username"]:
        raise HTTPException(status_code=400, detail="不能停用自己")
    user_store.set_active(username, False)
    audit.log("admin.user_deactivate", actor=current["username"], target=username, ip=ip, user_agent=ua)
    return {"ok": True}


@router.patch("/users/{username}")
async def update_profile(username: str, body: UpdateProfileRequest, request: Request,
                         current: dict = Depends(require_admin)):
    """Edit display_name / employee_id / email. Pass null to keep current."""
    ip, ua = _meta(request)
    try:
        user_store.update_profile(
            username,
            employee_id=body.employee_id,
            email=body.email,
            display_name=body.display_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    audit.log("admin.user_profile_update", actor=current["username"], target=username,
              ip=ip, user_agent=ua,
              details={k: v for k, v in body.model_dump().items() if v is not None})
    return {"ok": True}


@router.post("/users/{username}/role")
async def update_role(username: str, body: UpdateRoleRequest, request: Request,
                       current: dict = Depends(require_admin)):
    ip, ua = _meta(request)
    if body.role not in ("admin", "editor", "user"):
        raise HTTPException(status_code=400, detail="role 只能是 admin / editor / user")
    if username == current["username"] and body.role != "admin":
        raise HTTPException(status_code=400, detail="不能降級自己的管理員權限")
    try:
        user_store.set_role(username, body.role)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    audit.log("admin.user_role_change", actor=current["username"], target=username,
              ip=ip, user_agent=ua, details={"new_role": body.role})
    return {"ok": True}


@router.post("/users/{username}/reset-password")
async def reset_password(username: str, body: ResetPasswordRequest, request: Request,
                          current: dict = Depends(require_admin)):
    ip, ua = _meta(request)
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="密碼至少需要 8 個字元")
    try:
        user_store.admin_reset_password(username, hash_password(body.new_password))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    audit.log("admin.user_reset_password", actor=current["username"], target=username,
              ip=ip, user_agent=ua)
    return {"ok": True}


# ─────────── Audit log API ───────────

@router.get("/audit")
async def get_audit(
    limit: int = 100,
    offset: int = 0,
    actor: Optional[str] = None,
    action: Optional[str] = None,
    outcome: Optional[str] = None,
    since: Optional[str] = None,
    _: dict = Depends(require_admin),
):
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="limit 需介於 1~500")
    return {
        "items": audit.query(limit=limit, offset=offset, actor=actor,
                             action=action, outcome=outcome, since=since),
        "total": audit.count(actor=actor, action=action, outcome=outcome, since=since),
    }


@router.get("/audit/stats")
async def get_audit_stats(days: int = 7, _: dict = Depends(require_admin)):
    if days < 1 or days > 365:
        raise HTTPException(status_code=400, detail="days 需介於 1~365")
    return audit.stats_recent(days)


@router.get("/llm/queue")
async def get_llm_queue(_: dict = Depends(require_admin)):
    """Diagnostic: current Anthropic concurrency state."""
    from app.llm.client import get_queue_state
    return get_queue_state()


@router.get("/usage")
async def get_usage(days: int = 30, _: dict = Depends(require_admin)):
    if days < 1 or days > 365:
        raise HTTPException(status_code=400, detail="days 需介於 1~365")
    return session_store.usage_summary(days)


@router.get("/wiki-index/stats")
async def wiki_index_stats(_: dict = Depends(require_admin)):
    from app.storage import wiki_index
    return wiki_index.stats()


@router.post("/wiki-index/rebuild")
async def wiki_index_rebuild(request: Request, current: dict = Depends(require_admin)):
    ip, ua = _meta(request)
    from app.storage import wiki_index
    n = wiki_index.rebuild()
    audit.log("admin.wiki_index_rebuild", actor=current["username"],
              ip=ip, user_agent=ua, details={"pages_indexed": n})
    return {"ok": True, "pages_indexed": n}


@router.get("/ad/status")
async def get_ad_status(_: dict = Depends(require_admin)):
    """Diagnostic: AD integration status & configuration sanity check."""
    from app.auth import ldap_auth
    from app.config import settings as s

    enabled = ldap_auth.is_enabled()
    fmt_ok = False
    missing: list[str] = []
    if enabled:
        if not s.ad_host: missing.append("AD_HOST")
        if not s.ad_base_dn: missing.append("AD_BASE_DN")
        if s.ad_bind_format == "upn" and not s.ad_upn_suffix: missing.append("AD_UPN_SUFFIX")
        if s.ad_bind_format == "ntlm" and not s.ad_netbios: missing.append("AD_NETBIOS")
        if s.ad_bind_format == "dn" and not s.ad_user_dn_suffix: missing.append("AD_USER_DN_SUFFIX")
        fmt_ok = not missing

    # Count AD users
    ad_user_count = sum(1 for u in user_store.list_users() if u.get("auth_source") == "ad")

    return {
        "enabled": enabled,
        "configured": fmt_ok,
        "missing_settings": missing,
        "host": s.ad_host or None,
        "port": s.ad_port,
        "use_ssl": s.ad_use_ssl,
        "base_dn": s.ad_base_dn or None,
        "bind_format": s.ad_bind_format,
        "ad_user_count": ad_user_count,
    }


# ─────────── Scan / Reflect / Lint operations ───────────

class ReflectRequest(BaseModel):
    topic: str
    source_pages: list[str]
    target_type: str = "analysis"  # "analysis" or "comparison"
    target_name: Optional[str] = None


class LintRequest(BaseModel):
    scope: str = "all"


@router.get("/scan")
async def scan_now(request: Request, current: dict = Depends(require_admin)):
    """Synchronous scan: diff raw/ vs wiki frontmatter `sources`."""
    ip, ua = _meta(request)
    result = run_scan()
    audit.log("scan.run", actor=current["username"], ip=ip, user_agent=ua,
              details={"summary": result["summary"]})
    return result


@router.post("/reflect")
async def reflect(
    body: ReflectRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    current: dict = Depends(require_admin),
):
    ip, ua = _meta(request)
    if not body.topic.strip():
        raise HTTPException(status_code=400, detail="主題不可空白")
    if not body.source_pages:
        raise HTTPException(status_code=400, detail="至少需要一個來源頁面")
    if body.target_type not in ("analysis", "comparison"):
        raise HTTPException(status_code=400, detail="target_type 必須是 analysis 或 comparison")

    job_id = job_store.create_job("reflect", {
        "topic": body.topic,
        "source_pages": body.source_pages,
        "target_type": body.target_type,
        "target_name": body.target_name,
        "actor": current["username"],
    })

    audit.log("reflect.start", actor=current["username"], target=body.topic,
              ip=ip, user_agent=ua,
              details={"job_id": job_id, "source_pages": body.source_pages,
                       "target_type": body.target_type})

    background_tasks.add_task(
        run_reflect, job_id, current["username"],
        body.topic, body.source_pages, body.target_type, body.target_name,
    )
    return {"job_id": job_id, "status_url": f"/api/jobs/{job_id}"}


@router.post("/lint")
async def lint(
    body: LintRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    current: dict = Depends(require_admin),
):
    ip, ua = _meta(request)
    job_id = job_store.create_job("lint", {
        "scope": body.scope,
        "actor": current["username"],
    })

    audit.log("lint.start", actor=current["username"], target=body.scope,
              ip=ip, user_agent=ua, details={"job_id": job_id})

    background_tasks.add_task(run_lint, job_id, current["username"], body.scope)
    return {"job_id": job_id, "status_url": f"/api/jobs/{job_id}"}
