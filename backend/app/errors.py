"""Unified error response handler.

Spec calls for `{error: {code, message}}`. FastAPI's default is `{detail: "..."}`.
We emit both so:
  - new code can read `body.error.code` to switch on
  - legacy code keeps reading `body.detail`

Custom errors raise `AppError` with a stable code; plain HTTPException is also
wrapped (with a generic code derived from status).
"""
from __future__ import annotations
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(HTTPException):
    """HTTPException with a machine-readable code.

    Use sparingly for errors callers may want to discriminate on. For ad-hoc
    errors, raise plain HTTPException — the wrapper will assign a generic code.
    """
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(status_code=status_code, detail=message)
        self.code = code


# Stable codes for errors raised throughout the app
class Code:
    UNAUTHENTICATED = "UNAUTHENTICATED"
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    ACCOUNT_DISABLED = "ACCOUNT_DISABLED"
    RATE_LIMITED = "RATE_LIMITED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    BAD_REQUEST = "BAD_REQUEST"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
    UNSUPPORTED_MEDIA = "UNSUPPORTED_MEDIA"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
    INTERNAL = "INTERNAL"


_DEFAULT_CODE_BY_STATUS = {
    400: Code.BAD_REQUEST,
    401: Code.UNAUTHENTICATED,
    403: Code.FORBIDDEN,
    404: Code.NOT_FOUND,
    409: Code.CONFLICT,
    413: Code.PAYLOAD_TOO_LARGE,
    415: Code.UNSUPPORTED_MEDIA,
    422: Code.VALIDATION_ERROR,
    429: Code.RATE_LIMITED,
    503: Code.SERVICE_UNAVAILABLE,
}


def _build_body(status_code: int, code: str, message: str, extra: dict | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {
        # New spec form
        "error": {"code": code, "message": message},
        # Legacy form for callers still reading res.json().detail
        "detail": message,
    }
    if extra:
        body["error"].update(extra)
    return body


async def _http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    code = getattr(exc, "code", None) or _DEFAULT_CODE_BY_STATUS.get(exc.status_code, "HTTP_" + str(exc.status_code))
    # exc.detail can be a str or a dict; normalise to str
    if isinstance(exc.detail, dict):
        message = exc.detail.get("message", "") or str(exc.detail)
    else:
        message = str(exc.detail) if exc.detail is not None else ""
    return JSONResponse(
        status_code=exc.status_code,
        content=_build_body(exc.status_code, code, message),
        headers=getattr(exc, "headers", None),
    )


async def _validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = exc.errors()
    # First error message tends to be most actionable
    first = errors[0] if errors else {"msg": "請求格式錯誤"}
    message = first.get("msg", "請求格式錯誤")
    return JSONResponse(
        status_code=422,
        content=_build_body(422, Code.VALIDATION_ERROR, message, extra={"errors": errors}),
    )


async def _generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content=_build_body(500, Code.INTERNAL, "伺服器內部錯誤"),
    )


def register(app: FastAPI) -> None:
    app.add_exception_handler(HTTPException, _http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_exception_handler)
    # Don't catch Exception by default — uvicorn already logs nicely and you
    # want stack traces visible in dev. Uncomment to mask errors in prod:
    # app.add_exception_handler(Exception, _generic_exception_handler)
