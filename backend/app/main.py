import json
import logging
import time

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .logging_config import logger
from .routers import events, groups, users
from .storage import UPLOAD_DIR

# Schema management is Alembic's job — `alembic upgrade head`, run as Railway's
# pre-deploy command so it happens once per deploy rather than in every worker.
# The app deliberately does no DDL at startup.

app = FastAPI(title="WhereTheyAt", description="Festival friend-finder backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # demo: wide open
    allow_methods=["*"],
    allow_headers=["*"],
)

# Local-storage uploads (dev fallback). With S3 configured, files never land
# here and stored URLs are absolute, so this mount simply goes unused.
app.mount("/static", StaticFiles(directory=UPLOAD_DIR), name="uploads")

app.include_router(users.router)
app.include_router(groups.router)
app.include_router(events.router)

MAX_LOGGED_BODY_CHARS = 2000
SENSITIVE_KEYS = {"password", "token", "secret", "authorization"}


def _is_polling_path(method: str, path: str) -> bool:
    """The two hot paths (spec: ~1.5s location PUT, ~2s locations GET) plus
    /health would drown the log at INFO; they log at DEBUG instead."""
    return (
        path == "/health"
        or (method == "PUT" and path.startswith("/users/") and path.endswith("/location"))
        or (method == "GET" and path.startswith("/groups/") and path.endswith("/locations"))
    )


async def _posted_body(request: Request) -> str | None:
    """The request body as a loggable string: JSON with sensitive keys redacted,
    truncated; non-JSON (e.g. file uploads) summarized as type + size."""
    content_type = request.headers.get("content-type", "")
    size = request.headers.get("content-length")
    if size == "0" or (not content_type and size is None):
        return None  # body-less POST (e.g. join-by-code)
    if not content_type.startswith("application/json"):
        return f"<{content_type or 'no content-type'}, {size or '?'} bytes>"
    body = await request.body()
    if not body:
        return None
    try:
        data = json.loads(body)
        if isinstance(data, dict):
            data = {
                k: "[redacted]" if k.lower() in SENSITIVE_KEYS else v for k, v in data.items()
            }
        text = json.dumps(data)
    except ValueError:
        text = body.decode("utf-8", "replace")
    if len(text) > MAX_LOGGED_BODY_CHARS:
        text = text[:MAX_LOGGED_BODY_CHARS] + "…[truncated]"
    return text


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """One line per request: method, path, status, duration; POSTs include the
    posted body, error responses include the error detail (stashed on
    request.state by the exception handlers below)."""
    posted = await _posted_body(request) if request.method == "POST" else None
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        # Unhandled error: HTTPExceptions are turned into responses further in,
        # so only genuine bugs land here. Log the traceback with full request
        # context, then re-raise for unhandled_exception_handler to answer.
        duration_ms = (time.perf_counter() - start) * 1000
        message = f"{request.method} {request.url.path} -> 500 ({duration_ms:.1f}ms)"
        if posted is not None:
            message += f" body={posted}"
        logger.exception(message)
        raise

    duration_ms = (time.perf_counter() - start) * 1000
    message = f"{request.method} {request.url.path} -> {response.status_code} ({duration_ms:.1f}ms)"
    if posted is not None:
        message += f" body={posted}"
    error_detail = getattr(request.state, "error_detail", None)
    if error_detail is not None:
        message += f" error={error_detail!r}"
    if response.status_code >= 500:
        level = logging.ERROR
    elif response.status_code >= 400:
        level = logging.WARNING
    elif _is_polling_path(request.method, request.url.path):
        level = logging.DEBUG
    else:
        level = logging.INFO
    logger.log(level, message)
    return response


# Clients parse `detail` as a string (frontend/admin api.ts) — keep that shape;
# `code` is additive so error responses carry the status code in the body too.
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    request.state.error_detail = exc.detail
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "code": exc.status_code},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """422 with a human-readable `detail` string (clients show detail verbatim,
    and FastAPI's default list form would be dropped for a generic message);
    the full error list stays available under `errors`."""
    errors = exc.errors()
    summary = "; ".join(
        f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}" for error in errors
    )
    detail = f"Invalid request: {summary}" if summary else "Invalid request"
    request.state.error_detail = detail
    return JSONResponse(
        status_code=422,
        content={
            "detail": detail,
            "code": 422,
            # loc/msg/type only — `input` and `ctx` can hold non-JSON values.
            "errors": [
                {"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in errors
            ],
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Clean JSON instead of the default plain-text 500. The traceback was
    already logged with request context by log_requests."""
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "code": 500},
    )


@app.get("/health")
def health():
    return {"ok": True}
