# AGENTS.md

This file provides guidance to Agents when working with code in this repository.

## What this is

REST backend for WhereTheyAt, a festival friend-finder. iOS clients poll it: each client PUTs its GPS position every ~1.5s and GETs its group's locations every ~2s. Those two endpoints (`PUT /users/{id}/location`, `GET /groups/{id}/locations`) are the hot paths — keep them single-query and cheap. Everything else (users, groups, events, landmarks) is cold. The full spec is in `../spec.md`.

Stack: FastAPI + SQLAlchemy 2.0 (synchronous, deliberately) + Pydantic v2. Postgres both places — a local Postgres for dev (engine parity with prod), Railway Postgres in production. SQLite still works as a zero-setup fallback (unset `DATABASE_URL`) and the code must stay portable to it, but local dev now targets Postgres by default. Live GPS positions are the exception to "it's all SQL": they live in Redis, not the SQL database (see the locations bullet below), so local dev and prod both need a Redis reachable at `REDIS_URL`.

## Commands

```bash
# setup (once)
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# local Postgres + Redis (Homebrew on macOS; no Docker needed):
#   brew install postgresql@14 redis
#   brew services start postgresql@14 && brew services start redis
#   createdb wheretheyat_dev
# then in .env: DATABASE_URL=postgresql://<you>@localhost:5432/wheretheyat_dev
# (unset DATABASE_URL to fall back to SQLite; REDIS_URL defaults to
# redis://localhost:6379/0)

# schema (required before first run — the app does no DDL at startup)
alembic upgrade head

# run — CLERK_PUBLISHABLE_KEY must be set (see .env.example) or requests get 503;
# AUTH_DEV_MODE=1 skips token verification for keyless local dev.
uvicorn app.main:app --reload

# reset local state (Postgres): dropdb wheretheyat_dev && createdb wheretheyat_dev && alembic upgrade head
# reset local state (SQLite):   rm WhereTheyAt.db && alembic upgrade head

# after changing models.py
alembic revision --autogenerate -m "what changed"   # review the file before committing
alembic upgrade head

# end-to-end test (server must be running WITH AUTH_DEV_MODE=1;
# walks the spec's acceptance flow)
AUTH_DEV_MODE=1 uvicorn app.main:app --reload   # in one terminal
./smoke_test.sh                    # defaults to http://127.0.0.1:8000
./smoke_test.sh http://host:port
```

There is no pytest suite, linter, or build step — `smoke_test.sh` is the test. Reset local state with `dropdb wheretheyat_dev && createdb wheretheyat_dev && alembic upgrade head` (Postgres) or `rm WhereTheyAt.db && alembic upgrade head` (SQLite fallback).

## Architecture

Request flow: `app/main.py` (CORS, `create_all`, routers) → `app/routers/{users,groups,events}.py` → models in `app/models.py`, validation in `app/schemas.py`, session via `get_db` in `app/database.py`.

Cross-file invariants that matter when changing things:

- **Locations live in Redis, never in the main database.** `app/redis_client.py` is the only module that touches Redis. One key per user, `loc:<user_id>`, holding a JSON position written with a staleness TTL (`LOCATION_TTL_SECONDS`, default 90s) that is refreshed on every report — a client that stops reporting expires to no-location instead of freezing on the map. The write path (`PUT /users/{id}/location`) does a single `SET … EX`; the read path (`GET /groups/{id}/locations`) still gets the roster (memberships → users) from Postgres in one query, then a single Redis `MGET` fills in positions, with missing/expired keys rendered as `"location": null` — same contract a member who never reported always had. There is no history, no per-group copy, and no `locations` table (dropped in migration `29fa5cd32665`). Don't reintroduce a DB location table or a per-group/trail store. The `LocationOut`/`LocationSnapshot` schemas are unchanged, so both clients' types still hold; the PUT response is built from the stored payload (the app reads it back as `lastAck`).
- **Dual-database portability is load-bearing.** UUIDs are `String(36)` columns (not native UUID types), and timestamps go through the `TZDateTime` decorator in `models.py`, which re-attaches UTC on read because SQLite drops tzinfo. New UUID/timestamp columns must use the same pattern or Postgres and SQLite will diverge. `database.py` also enables SQLite's foreign-key pragma per-connection — cascades silently stop working locally without it.
- **Uploads go through the storage abstraction in `app/storage.py`** — never write upload files directly. Two backends chosen by env at startup: S3 (any S3-compatible service; set `S3_BUCKET`, optionally `S3_ENDPOINT_URL`/`S3_PUBLIC_URL`) storing *absolute* URLs, or local disk under `uploads/` (dev fallback, served by the `/static` mount in `main.py`) storing *relative* paths — relative because the dev host is a changing LAN IP; the frontend's `avatarUri` handles both forms. Keys are namespaced per feature (`avatars/…`, `albums/{group_id}/…` when built). Filenames carry a random suffix and every prior object for that user is deleted on upload (`delete_prefix`); that rotation is what stops clients showing a cached old picture, so don't "simplify" it to a fixed `{user_id}.jpg`. S3 objects are cached immutable for a year for the same reason. The S3 path is testable without AWS via moto (`ThreadedMotoServer` + a public-read bucket policy).
- **Schema changes go through Alembic** (`alembic/`, baseline revision `9b84bb2b671e`). The app does **no DDL at startup** — `create_all()` and the old hand-rolled `ensure_columns()` are both gone, so a database that hasn't had `alembic upgrade head` run against it will 500 on first query. Production runs the upgrade as Railway's *pre-deploy command*, once per deploy, not per worker. `env.py` takes the URL from `DATABASE_URL` via `app.database` (never from `alembic.ini`, which has no credentials) and sets `render_as_batch` on SQLite so migrations written against Postgres still apply locally. Autogenerate renders the `TZDateTime` decorator as an unimportable `app.models.TZDateTime` — always replace it with `sa.DateTime(timezone=True)` in a generated revision, as the baseline does. `alembic check` reports drift between the models and the current head.
- **Auth is Clerk (email + password, email-code verification), verified in `app/auth.py`.** Clients send Clerk's session JWT as `Authorization: Bearer`; the backend verifies it against Clerk's JWKS (cached, no per-request network call) and maps `sub` → `users.clerk_id`. Two dependencies with a deliberate split: `get_clerk_id` (token check only, no DB hit) guards reads, `get_current_user` (adds the indexed users lookup) guards anything needing the local row; writes then call `require_self` / `check_event_admin`, so client-supplied user ids are never trusted. `POST /users` is the idempotent profile-provisioning step (201 new / 200 existing, keyed on clerk_id); `GET /users/me` reads it back. The hot paths keep their original query counts — location PUT swapped `get_user_or_404` for the clerk_id lookup, and the group-locations read uses `get_clerk_id` only. `AUTH_DEV_MODE=1` accepts any bearer token verbatim as the clerk_id (smoke_test.sh depends on this; never set it in prod). Platform admins (`users.is_admin`, still granted only by direct DB update) bypass `check_event_admin`.
- **Engine configuration is dialect-split in `database.py`.** `normalize_database_url()` rewrites the `postgres://` scheme Railway hands out to `postgresql+psycopg2://` (SQLAlchemy 2.0 rejects the bare form). SQLite gets `check_same_thread=False` plus the FK pragma listener; Postgres gets `pool_pre_ping=True` (managed Postgres drops idle connections — without it the first request after a quiet spell 500s), `pool_recycle=1800`, and `pool_size=10`/`max_overflow=10` per worker, sized for the polling load rather than the 5+10 default. The exported `DATABASE_URL` constant is what `alembic/env.py` imports, so app and migrations can never disagree about which database they mean.
- **Join codes** are 4 uppercase letters generated in `routers/groups.py`; uniqueness is enforced by the DB constraint and a retry loop on `IntegrityError`, not by pre-checking.
- **Status-code conventions the client relies on:** join-by-code is idempotent (201 new, 200 existing membership) but returns 409 when the group's event has already ended — deliberately distinct from the 404 for an unknown code, since the client shows different copy for each; `DELETE` endpoints return 204; failed admin check is 403; landmark `DELETE` takes `creator_id` as a query param since DELETE has no body.
- **A group's lifetime is its event's.** `has_ended()` in `routers/groups.py` is the server-side rule (with `event_has_ended()` resolving it through a group), and it must keep matching the client's: a group with no `event_id`, or an event with no `ends_at`, never expires (those rows predate event scheduling). Both write paths enforce it — creating a group against a finished event and joining one are each 409 — but reads of a finished group still work, which is what lets the client render group history.
- **Logging and error responses are centralized in `main.py`** (logger configured in `app/logging_config.py`, level via `LOG_LEVEL`, default INFO). The `log_requests` middleware emits one line per request — method, path, status, duration, the JSON body for POSTs (sensitive keys redacted, truncated at 2 KB), and the error detail for failures; the two hot paths and `/health` log at DEBUG so INFO stays readable, 4xx logs WARNING, 5xx logs ERROR with traceback. Exception handlers keep `detail` a *string* in every error body — both clients' `api.ts` parse it verbatim, including the 422 handler's flattened validation summary — and add an additive `code` field; unhandled exceptions return `{"detail": "Internal server error", "code": 500}` instead of plain text. New error paths should raise `HTTPException` and rely on this machinery rather than logging ad hoc.

Explicitly out of scope per spec: WebSockets/push, location history, PostGIS/spatial queries, rate limiting, pagination, caching. (Auth was originally out of scope too; that decision was reversed — see the Clerk bullet above. Locations were originally a SQL table; that was reversed too — they're in Redis now, see the locations bullet.)
