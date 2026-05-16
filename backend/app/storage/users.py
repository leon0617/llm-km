import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from app.config import settings

_lock = threading.Lock()


def _path() -> Path:
    return settings.users_file


def _load() -> dict:
    p = _path()
    if not p.exists():
        return {}
    return json.loads(p.read_text())


def _save(data: dict):
    _path().parent.mkdir(parents=True, exist_ok=True)
    _path().write_text(json.dumps(data, ensure_ascii=False, indent=2))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _migrate_record(rec: dict) -> dict:
    """Backfill optional fields on legacy records so callers can rely on them."""
    rec.setdefault("employee_id", "")
    rec.setdefault("email", "")
    rec.setdefault("auth_source", "local")
    rec.setdefault("must_change_password", False)
    rec.setdefault("created_at", None)
    rec.setdefault("last_login_at", None)
    return rec


def get_user(username: str) -> dict | None:
    with _lock:
        u = _load().get(username)
        return _migrate_record(u) if u else None


def list_users() -> list[dict]:
    with _lock:
        data = _load()
        return [
            _migrate_record({"username": k, **{kk: vv for kk, vv in v.items() if kk != "password_hash"}})
            for k, v in data.items()
        ]


def create_user(
    username: str,
    password_hash: str = "",
    role: str = "user",
    display_name: str = "",
    must_change_password: bool = True,
    auth_source: str = "local",
    employee_id: str = "",
    email: str = "",
) -> dict:
    """Create a user record.

    - auth_source="local": `password_hash` required, normal bcrypt verify on login.
    - auth_source="ad":    `password_hash` ignored, login is via LDAP bind.
    """
    if auth_source not in ("local", "ad"):
        raise ValueError(f"無效的 auth_source：{auth_source}")
    if auth_source == "local" and not password_hash:
        raise ValueError("本地帳號需要密碼")

    with _lock:
        data = _load()
        if username in data:
            raise ValueError(f"使用者 {username} 已存在")
        record = {
            "username": username,
            "password_hash": password_hash,
            "role": role,
            "display_name": display_name or username,
            "active": True,
            "auth_source": auth_source,
            "employee_id": employee_id,
            "email": email,
            "created_at": _now(),
            "last_login_at": None,
        }
        # AD users have no password to change — the flag is irrelevant.
        if auth_source == "local":
            record["must_change_password"] = must_change_password
        else:
            record["must_change_password"] = False
        data[username] = record
        _save(data)
        return data[username]


def update_profile(username: str, employee_id: str | None = None, email: str | None = None,
                    display_name: str | None = None):
    """Update user profile fields. Pass None to keep existing value."""
    with _lock:
        data = _load()
        if username not in data:
            raise ValueError("使用者不存在")
        if employee_id is not None:
            data[username]["employee_id"] = employee_id
        if email is not None:
            data[username]["email"] = email
        if display_name is not None:
            data[username]["display_name"] = display_name or username
        _save(data)


def update_password(username: str, password_hash: str, clear_must_change: bool = True):
    with _lock:
        data = _load()
        if username not in data:
            raise ValueError("使用者不存在")
        if data[username].get("auth_source") == "ad":
            raise ValueError("AD 帳號的密碼由 AD 管理，無法在此修改")
        data[username]["password_hash"] = password_hash
        if clear_must_change:
            data[username]["must_change_password"] = False
        _save(data)


def admin_reset_password(username: str, password_hash: str):
    """Admin reset forces user to change on next login."""
    with _lock:
        data = _load()
        if username not in data:
            raise ValueError("使用者不存在")
        if data[username].get("auth_source") == "ad":
            raise ValueError("AD 帳號的密碼由 AD 管理，無法在此重設")
        data[username]["password_hash"] = password_hash
        data[username]["must_change_password"] = True
        _save(data)


def set_role(username: str, role: str):
    with _lock:
        data = _load()
        if username not in data:
            raise ValueError("使用者不存在")
        data[username]["role"] = role
        _save(data)


def set_active(username: str, active: bool):
    with _lock:
        data = _load()
        if username not in data:
            raise ValueError("使用者不存在")
        data[username]["active"] = active
        _save(data)


def update_last_login(username: str):
    with _lock:
        data = _load()
        if username not in data:
            return
        data[username]["last_login_at"] = _now()
        _save(data)


def delete_user(username: str):
    with _lock:
        data = _load()
        data.pop(username, None)
        _save(data)


def bootstrap_admin(username: str, password_hash: str):
    """Create the bootstrap admin if it doesn't exist.

    Forces password change on first login so the env-default password
    cannot stay in use.
    """
    with _lock:
        data = _load()
        if username not in data:
            data[username] = {
                "username": username,
                "password_hash": password_hash,
                "role": "admin",
                "display_name": "管理員",
                "active": True,
                "auth_source": "local",
                "employee_id": "",
                "email": "",
                "must_change_password": True,
                "created_at": _now(),
                "last_login_at": None,
            }
            _save(data)
