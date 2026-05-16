"""Active Directory authentication via LDAP bind.

Disabled by default. Activated when `AD_ENABLED=true` in .env and the
necessary `AD_HOST` / `AD_BASE_DN` / format-specific fields are filled.

Each AD-backed user record in users.json carries `auth_source="ad"`. On login,
the server attempts an LDAP simple bind with the credentials supplied by the
user. Bind success → authenticated. The AD password is never stored.
"""
from __future__ import annotations
import logging

from app.config import settings

log = logging.getLogger(__name__)


class ADConfigError(RuntimeError):
    """Raised when AD is enabled but configuration is incomplete."""


def is_enabled() -> bool:
    return bool(settings.ad_enabled)


def _format_bind_username(username: str) -> str:
    fmt = settings.ad_bind_format
    if fmt == "upn":
        if not settings.ad_upn_suffix:
            raise ADConfigError("AD_BIND_FORMAT=upn 需要 AD_UPN_SUFFIX 設定")
        return f"{username}@{settings.ad_upn_suffix}"
    if fmt == "ntlm":
        if not settings.ad_netbios:
            raise ADConfigError("AD_BIND_FORMAT=ntlm 需要 AD_NETBIOS 設定")
        return f"{settings.ad_netbios}\\{username}"
    if fmt == "dn":
        if not settings.ad_user_dn_suffix:
            raise ADConfigError("AD_BIND_FORMAT=dn 需要 AD_USER_DN_SUFFIX 設定")
        return f"CN={username},{settings.ad_user_dn_suffix}"
    raise ADConfigError(f"未知的 AD_BIND_FORMAT：{fmt}")


def verify_credentials(username: str, password: str) -> tuple[bool, dict]:
    """Try LDAP bind. Returns (success, attrs).

    `attrs` is a dict that may contain {"display_name", "email"} on success,
    or {"error": "..."} on failure.
    """
    if not is_enabled():
        return False, {"error": "AD 未啟用"}
    if not settings.ad_host or not settings.ad_base_dn:
        return False, {"error": "AD 設定不完整（缺 AD_HOST / AD_BASE_DN）"}
    if not username or not password:
        return False, {"error": "帳號或密碼為空"}

    try:
        from ldap3 import Server, Connection, ALL, SUBTREE
        from ldap3.core.exceptions import LDAPException
    except ImportError:
        log.error("ldap3 not installed but AD is enabled")
        return False, {"error": "伺服器缺少 ldap3 套件"}

    try:
        bind_user = _format_bind_username(username)
    except ADConfigError as e:
        return False, {"error": str(e)}

    server = Server(
        host=settings.ad_host,
        port=settings.ad_port,
        use_ssl=settings.ad_use_ssl,
        get_info=ALL,
        connect_timeout=settings.ad_connect_timeout_sec,
    )

    try:
        conn = Connection(
            server,
            user=bind_user,
            password=password,
            auto_bind=True,
            raise_exceptions=False,
            receive_timeout=settings.ad_connect_timeout_sec,
        )
    except LDAPException as e:
        log.warning("AD bind failed for %s: %s", username, e)
        return False, {"error": f"AD 連線/認證失敗：{type(e).__name__}"}

    if not conn.bound:
        return False, {"error": conn.last_error or "AD bind 未成功"}

    attrs: dict = {}
    try:
        ok = conn.search(
            search_base=settings.ad_base_dn,
            search_filter=f"(sAMAccountName={_escape(username)})",
            search_scope=SUBTREE,
            attributes=["displayName", "mail", "cn"],
        )
        if ok and conn.entries:
            entry = conn.entries[0]
            if "displayName" in entry and entry.displayName.value:
                attrs["display_name"] = str(entry.displayName.value)
            elif "cn" in entry and entry.cn.value:
                attrs["display_name"] = str(entry.cn.value)
            if "mail" in entry and entry.mail.value:
                attrs["email"] = str(entry.mail.value)
    except Exception as e:  # noqa: BLE001
        log.warning("AD attribute lookup failed for %s: %s", username, e)
    finally:
        try:
            conn.unbind()
        except Exception:  # noqa: BLE001
            pass

    return True, attrs


def lookup_attrs(username: str) -> dict | None:
    """Anonymous-ish lookup used by admin UI to pre-fill display_name when
    creating an AD-backed local user record. Returns None if not found or AD
    is disabled. Currently not implemented (requires a service account)."""
    # Intentionally stubbed: most AD servers don't permit anonymous search.
    # Wire a service-account bind here later if you want this in admin UI.
    return None


def _escape(value: str) -> str:
    """Escape LDAP search filter special characters per RFC 4515."""
    return (
        value.replace("\\", "\\5c")
             .replace("*", "\\2a")
             .replace("(", "\\28")
             .replace(")", "\\29")
             .replace("\x00", "\\00")
    )
