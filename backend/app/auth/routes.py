from fastapi import APIRouter, HTTPException, Response, Depends, Request
from pydantic import BaseModel
from app.errors import AppError, Code
from app.auth.jwt import create_access_token
from app.auth.password import verify_password, hash_password
from app.auth.deps import get_current_user
from app.storage import users as user_store
from app.storage import audit
from app.auth import rate_limit
from app.auth import ldap_auth
from app.config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


def _validate_password(pw: str) -> str | None:
    if len(pw) < 8:
        return "密碼至少需要 8 個字元"
    if not any(c.isalpha() for c in pw):
        return "密碼需包含英文字母"
    if not any(c.isdigit() for c in pw):
        return "密碼需包含數字"
    return None


def _client_meta(request: Request) -> tuple[str, str]:
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "")
    if "," in ip:
        ip = ip.split(",")[0].strip()
    ua = request.headers.get("user-agent", "")
    return ip, ua


@router.post("/login")
async def login(body: LoginRequest, response: Response, request: Request):
    ip, ua = _client_meta(request)

    # ── Brute-force protection: refuse early if this (IP, username) is locked.
    locked, remaining = rate_limit.check(ip, body.username)
    if locked:
        audit.log("auth.login", actor=body.username, outcome="denied",
                  ip=ip, user_agent=ua, details={"reason": "rate_limited", "retry_after": remaining})
        raise AppError(
            status_code=429, code=Code.RATE_LIMITED,
            message=f"嘗試次數過多，請於 {remaining // 60} 分 {remaining % 60} 秒後再試",
        )

    user = user_store.get_user(body.username)
    auth_ok = False
    auth_attrs: dict = {}
    if user is not None:
        if user.get("auth_source") == "ad":
            if not ldap_auth.is_enabled():
                audit.log("auth.login", actor=body.username, outcome="denied",
                          ip=ip, user_agent=ua,
                          details={"reason": "ad_disabled_but_user_is_ad"})
                raise HTTPException(status_code=503, detail="AD 認證未啟用，請聯絡管理員")
            auth_ok, auth_attrs = ldap_auth.verify_credentials(body.username, body.password)
        else:
            auth_ok = verify_password(body.password, user["password_hash"])

    if user is None or not auth_ok:
        now_locked, fails_left = rate_limit.record_failure(ip, body.username)
        details: dict = {"reason": "invalid_credentials"}
        if user is not None and user.get("auth_source") == "ad":
            details["auth_source"] = "ad"
            if auth_attrs.get("error"):
                details["ad_error"] = auth_attrs["error"]
        if now_locked:
            details["lockout"] = True
        elif fails_left > 0:
            details["fails_remaining"] = fails_left
        audit.log("auth.login", actor=body.username, outcome="failure",
                  ip=ip, user_agent=ua, details=details)
        if now_locked:
            raise AppError(status_code=429, code=Code.RATE_LIMITED,
                           message="嘗試次數過多，已暫時鎖定 15 分鐘")
        msg = "帳號或密碼錯誤"
        if fails_left <= 2:
            msg += f"（剩 {fails_left} 次嘗試）"
        raise AppError(status_code=401, code=Code.INVALID_CREDENTIALS, message=msg)
    if not user.get("active", True):
        audit.log("auth.login", actor=user["username"], outcome="denied",
                  ip=ip, user_agent=ua, details={"reason": "account_disabled"})
        raise AppError(status_code=403, code=Code.ACCOUNT_DISABLED, message="帳號已停用")

    rate_limit.record_success(ip, body.username)
    user_store.update_last_login(user["username"])

    token = create_access_token(user["username"], user["role"])
    response.set_cookie(
        "access_token", token,
        httponly=True, samesite="lax", secure=settings.cookie_secure,
        max_age=60 * 60 * 8,
    )

    audit.log("auth.login", actor=user["username"], outcome="success",
              ip=ip, user_agent=ua,
              details={"must_change_password": user.get("must_change_password", False)})

    return {
        "username": user["username"],
        "role": user["role"],
        "display_name": user.get("display_name", user["username"]),
        "must_change_password": user.get("must_change_password", False),
        "auth_source": user.get("auth_source", "local"),
    }


@router.post("/logout")
async def logout(response: Response, request: Request):
    ip, ua = _client_meta(request)
    # Try to identify the actor from the (possibly still valid) cookie, but don't require it.
    actor = None
    token = request.cookies.get("access_token")
    if token:
        from app.auth.jwt import decode_access_token
        payload = decode_access_token(token)
        if payload:
            actor = payload.get("sub")
    response.delete_cookie(
        "access_token",
        httponly=True, samesite="lax", secure=settings.cookie_secure,
    )
    audit.log("auth.logout", actor=actor, ip=ip, user_agent=ua)
    return {"ok": True}


@router.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    return {
        "username": current_user["username"],
        "role": current_user["role"],
        "display_name": current_user.get("display_name", current_user["username"]),
        "must_change_password": current_user.get("must_change_password", False),
        "auth_source": current_user.get("auth_source", "local"),
    }


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    ip, ua = _client_meta(request)
    actor = current_user["username"]
    if current_user.get("auth_source") == "ad":
        raise HTTPException(status_code=400, detail="AD 帳號的密碼請至公司 AD 系統變更")
    if not verify_password(body.old_password, current_user["password_hash"]):
        audit.log("auth.change_password", actor=actor, outcome="failure",
                  ip=ip, user_agent=ua, details={"reason": "wrong_old_password"})
        raise HTTPException(status_code=400, detail="舊密碼錯誤")
    err = _validate_password(body.new_password)
    if err:
        audit.log("auth.change_password", actor=actor, outcome="failure",
                  ip=ip, user_agent=ua, details={"reason": "weak_password"})
        raise HTTPException(status_code=400, detail=err)
    if body.new_password == body.old_password:
        audit.log("auth.change_password", actor=actor, outcome="failure",
                  ip=ip, user_agent=ua, details={"reason": "same_as_old"})
        raise HTTPException(status_code=400, detail="新密碼不能與舊密碼相同")

    user_store.update_password(actor, hash_password(body.new_password))
    audit.log("auth.change_password", actor=actor, outcome="success", ip=ip, user_agent=ua)
    return {"ok": True}
