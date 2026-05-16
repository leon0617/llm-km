from fastapi import Cookie, Depends, HTTPException, status
from app.auth.jwt import decode_access_token
from app.storage import users as user_store

# Role hierarchy (high → low). Higher roles inherit lower-role permissions.
ROLES = ("admin", "editor", "user")
ROLE_LABELS = {
    "admin": "管理員",
    "editor": "編輯者",
    "user": "一般使用者",
}


def get_current_user(access_token: str | None = Cookie(default=None)) -> dict:
    if not access_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登入")
    payload = decode_access_token(access_token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token 無效或已過期")
    user = user_store.get_user(payload["sub"])
    if user is None or not user.get("active", True):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="帳號不存在或已停用")
    return user


def require_role(*allowed: str):
    """FastAPI dependency factory: returns a dep that ensures the current user
    has one of the listed roles. Use as `Depends(require_role('admin', 'editor'))`."""
    def _dep(current: dict = Depends(get_current_user)) -> dict:
        if current.get("role") not in allowed:
            labels = "/".join(ROLE_LABELS.get(r, r) for r in allowed)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"需要 {labels} 權限",
            )
        return current
    return _dep


# Common shortcuts. Use these directly in `Depends(...)`.
require_admin = require_role("admin")
require_editor = require_role("admin", "editor")  # admin inherits editor's powers
require_user = get_current_user  # any authenticated user
