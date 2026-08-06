"""Clerk-backed authentication.

Identity lives in Clerk (email/password with email verification). The app
sends Clerk's session JWT as `Authorization: Bearer <token>`; we verify the
signature against Clerk's JWKS (fetched once, then cached — no per-request
network call) and map the token's `sub` claim to a local row via
users.clerk_id.

Config (env):
- CLERK_PUBLISHABLE_KEY — the pk_test_/pk_live_ key from the Clerk dashboard.
  The Clerk frontend-API domain is base64-encoded inside it, so this one value
  is all the backend needs to locate the JWKS and expected issuer.
- CLERK_ISSUER — optional explicit override (e.g. "https://xxx.clerk.accounts.dev").
- AUTH_DEV_MODE=1 — skip verification and treat the raw bearer token as the
  clerk_id. For smoke_test.sh and keyless local dev only; never set in prod.
"""
import base64
import os

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models
from .database import get_db
from .logging_config import logger

AUTH_DEV_MODE = os.getenv("AUTH_DEV_MODE") == "1"

# The `scope` claim on tokens minted from Clerk's `background` JWT template.
# These are long-lived (hours, vs a session token's 60s) because a headless
# background location task can't run Clerk's refresh loop — so they buy their
# lifetime by being accepted on exactly one endpoint.
BACKGROUND_SCOPE = "bg-location"


def _resolve_issuer() -> str | None:
    explicit = os.getenv("CLERK_ISSUER")
    if explicit:
        return explicit.rstrip("/")
    pk = os.getenv("CLERK_PUBLISHABLE_KEY", "")
    for prefix in ("pk_test_", "pk_live_"):
        if pk.startswith(prefix):
            encoded = pk.removeprefix(prefix)
            # The key embeds base64("<frontend-api-domain>$").
            domain = (
                base64.b64decode(encoded + "=" * (-len(encoded) % 4)).decode().rstrip("$")
            )
            return f"https://{domain}"
    return None


CLERK_ISSUER = _resolve_issuer()

if AUTH_DEV_MODE:
    logger.warning("AUTH_DEV_MODE=1 — bearer tokens are NOT verified. Dev only.")
elif CLERK_ISSUER is None:
    logger.warning(
        "Clerk is not configured (set CLERK_PUBLISHABLE_KEY or CLERK_ISSUER); "
        "all authenticated endpoints will return 503."
    )

_jwks_client: jwt.PyJWKClient | None = None


def _jwks() -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = jwt.PyJWKClient(
            f"{CLERK_ISSUER}/.well-known/jwks.json", cache_keys=True
        )
    return _jwks_client


_bearer = HTTPBearer(auto_error=False)


def verify_clerk_token(token: str) -> str:
    """Verify a raw Clerk session JWT and return its `sub` (the Clerk user id).

    Rejects a background-scoped token (see `verify_clerk_token_scoped`), so every
    existing caller is closed to them by default rather than by remembering to
    check. Raises HTTPException on any failure so all callers get a consistent
    status code.
    """
    clerk_id, scope = verify_clerk_token_scoped(token)
    if scope is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This token is only valid for background location reports",
        )
    return clerk_id


def verify_clerk_token_scoped(token: str) -> tuple[str, str | None]:
    """Verify a raw Clerk JWT and return `(sub, scope)`.

    The transport-agnostic core of auth: `get_clerk_id` wraps it for HTTP
    (pulling the token from the Authorization header), and the WebSocket path
    calls `verify_clerk_token` directly with the token from the query string,
    since a socket upgrade can't carry an `Authorization` header through React
    Native.

    `scope` is None for an ordinary session token. It is `BACKGROUND_SCOPE` for
    one minted from the `background` JWT template, which the app caches on disk
    so a headless location task can report without React (and therefore without
    Clerk's 60s refresh loop). Those live for hours instead of a minute, so they
    are deliberately good for one thing only — see `get_location_writer`.
    """
    if AUTH_DEV_MODE:
        # Dev tokens carry the scope as a prefix so smoke tests can exercise
        # both paths without a Clerk instance.
        if token.startswith(f"{BACKGROUND_SCOPE}:"):
            return token.removeprefix(f"{BACKGROUND_SCOPE}:"), BACKGROUND_SCOPE
        return token, None
    if CLERK_ISSUER is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth is not configured on the server "
            "(set CLERK_PUBLISHABLE_KEY, or AUTH_DEV_MODE=1 for local dev)",
        )
    try:
        signing_key = _jwks().get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=CLERK_ISSUER,
            # Clerk session tokens rotate every ~60s; small leeway absorbs clock skew.
            leeway=10,
            options={"require": ["exp", "iat", "sub"]},
        )
    except jwt.PyJWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid token: {e}"
        )
    # An ordinary session token carries no `scope` claim at all. Anything that
    # does is restricted, and an *unrecognized* scope stays restricted — failing
    # closed, so a future template can't accidentally mint full-access tokens.
    return payload["sub"], payload.get("scope")


def get_clerk_id(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    """Verify the bearer token and return the Clerk user id (`sub`).

    Use this directly for read endpoints that only need "is signed in";
    use get_current_user when the local users row is needed.
    """
    if creds is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token"
        )
    return verify_clerk_token(creds.credentials)


def get_current_user(
    clerk_id: str = Depends(get_clerk_id), db: Session = Depends(get_db)
) -> models.User:
    """The signed-in user's local row; 404 until POST /users has provisioned it."""
    user = db.execute(
        select(models.User).where(models.User.clerk_id == clerk_id)
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No profile for this account yet — POST /users to create one",
        )
    return user


def get_location_writer(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> models.User:
    """The signed-in user, for the location-report endpoint only.

    The one dependency that accepts a background-scoped token alongside a normal
    session token — a minimized app reporting its position is exactly what those
    are for. Everything else in the API goes through `get_clerk_id` /
    `get_current_user`, which reject them.
    """
    if creds is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token"
        )
    clerk_id, scope = verify_clerk_token_scoped(creds.credentials)
    if scope is not None and scope != BACKGROUND_SCOPE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Token scope not accepted here"
        )
    user = db.execute(
        select(models.User).where(models.User.clerk_id == clerk_id)
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No profile for this account yet — POST /users to create one",
        )
    return user


def require_self(user: models.User, user_id: str) -> None:
    """403 when a path/body user id doesn't belong to the authenticated caller."""
    if user.id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only act on your own account",
        )
