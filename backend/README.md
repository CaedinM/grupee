# Grupee backend

REST backend for **Grupee**, a festival friend-finder. iOS clients register a user, report their GPS position every ~1.5 s, and poll their group's locations every ~2 s. Events (festivals) hold a shared boundary polygon and landmark pins that groups can link to.

FastAPI · SQLAlchemy 2.0 (sync) · Pydantic v2 · PostgreSQL (local + production; SQLite still works as a fallback) · Redis for live positions.

Live GPS positions are held in **Redis**, not the SQL database — one key per user, `loc:<user_id>`, written with a staleness TTL. Only the two hot paths (`PUT /users/{id}/location`, `GET /groups/{id}/locations`) touch it, through `app/redis_client.py`. Everything else (users, groups, events, landmarks) is SQL.

## Run locally

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Local Postgres + Redis (Homebrew on macOS; no Docker needed):
brew install postgresql@14 redis
brew services start postgresql@14 && brew services start redis
createdb wheretheyat_dev
# then in .env:
#   DATABASE_URL=postgresql://<your-macos-user>@localhost:5432/wheretheyat_dev
#   (REDIS_URL defaults to redis://localhost:6379/0)

alembic upgrade head          # build the schema (required — the app does no DDL)
# Auth needs CLERK_PUBLISHABLE_KEY in .env (see .env.example), or use
# AUTH_DEV_MODE=1 to skip token verification for local dev:
uvicorn app.main:app --reload
```

The API is at http://127.0.0.1:8000 — interactive docs at http://127.0.0.1:8000/docs.
Reset local state with `dropdb wheretheyat_dev && createdb wheretheyat_dev && alembic upgrade head`.

**Prefer no local services?** Unset `DATABASE_URL` to fall back to file-based SQLite (`sqlite:///./WhereTheyAt.db`) — the same code runs on both. You'd still need a Redis for live locations. Postgres is the default because it's engine parity with production; SQLite trades that for zero setup.

## Schema migrations

Alembic owns the schema; the app creates nothing at startup. After editing `app/models.py`:

```bash
alembic revision --autogenerate -m "what changed"   # review the generated file
alembic upgrade head
alembic check                                       # models vs. head — should report no drift
```

Two things to know when reviewing a generated revision: the `TZDateTime` decorator renders as an unimportable `app.models.TZDateTime` and must be replaced with `sa.DateTime(timezone=True)`, and `alembic.ini` deliberately carries no `sqlalchemy.url` — `env.py` reads `DATABASE_URL` so migrations always follow the app's database.

## Authentication

Identity lives in [Clerk](https://clerk.com) (email + password, email-code verification). The app sends Clerk's session JWT as `Authorization: Bearer <token>` on every request; the backend verifies it against Clerk's JWKS and maps it to a local user via `users.clerk_id`. Set `CLERK_PUBLISHABLE_KEY` (the same key the frontend uses — the issuer domain is encoded inside it). All endpoints except `/health` require a token; user-scoped writes additionally require the token to match the target user.

## Smoke test

With the server running in dev-auth mode (`AUTH_DEV_MODE=1 uvicorn app.main:app --reload` — bearer tokens are taken verbatim as Clerk user ids, no verification):

```bash
./smoke_test.sh                # or ./smoke_test.sh http://host:port
```

It walks the full acceptance flow: unauthenticated requests are rejected, two users register, one creates a group and the other joins by code, both report locations, the group-locations read returns both, an event gets a boundary and two landmarks, the map read returns them, and writes as the wrong user are rejected with 403.

## API overview

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness check (the only unauthenticated route) |
| POST | `/users` | provision the signed-in account's profile (idempotent: 201 new / 200 existing) |
| GET | `/users/me` | the signed-in account's profile |
| GET | `/users/{id}` | fetch a user |
| PATCH | `/users/{id}` | rename (display name) |
| PUT | `/users/{id}/avatar` | upload a profile picture (multipart `file`, JPEG/PNG/WebP, ≤5 MB) |
| DELETE | `/users/{id}/avatar` | remove the profile picture |
| PUT 🔥 | `/users/{id}/location` | upsert latest position (hot path) |
| GET | `/users/{id}/groups` | groups the user belongs to, with role |
| POST | `/groups` | create a crew; returns a 4-letter join code |
| GET | `/groups/{id}` | group metadata + members |
| GET | `/groups/by-code/{code}` | preview a group before joining |
| POST | `/groups/{code}/members` | join by code as the signed-in user (idempotent, no body) |
| GET 🔥 | `/groups/{id}/locations` | every member's latest location (hot path) |
| DELETE | `/groups/{id}/members/{user_id}` | leave the group |
| POST | `/events` | create a festival |
| GET | `/events` | list festivals |
| GET | `/events/{id}` | event incl. boundary |
| GET | `/events/{id}/map` | boundary + landmarks in one read |
| PUT | `/events/{id}/boundary` | admin sets polygon (creator check) |
| POST | `/events/{id}/landmarks` | admin adds a pin (creator check) |
| GET | `/events/{id}/landmarks` | list pins |
| DELETE | `/events/{id}/landmarks/{lid}` | admin removes a pin |

Event writes are allowed for the event's creator (from the verified token) and platform admins (`users.is_admin`, granted only by direct DB update); anyone else gets 403.

## Deploy (Railway)

`railway.json` in this directory carries the build and deploy config — Nixpacks build, `alembic upgrade head` as the pre-deploy command, `uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 2` as the start command, and `/health` as the healthcheck. Python is pinned by `.python-version`.

Set up, once:

1. Create a Railway project from this repo and add a **Postgres** database and a **Redis** database to it.
2. On the API service, set **Root Directory** to `backend` (this is a monorepo — the repo root has no Python).
3. Set the service variables:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — a Railway reference, so it resolves over the private network |
   | `REDIS_URL` | `${{Redis.REDIS_URL}}` — the live-location store; reference it so it stays on the private network |
   | `CLERK_PUBLISHABLE_KEY` | your Clerk key (`pk_live_...` once a production instance exists) |
   | `LOG_LEVEL` | `INFO` |

   **Never set `AUTH_DEV_MODE` on a deployed service** — it accepts any bearer token without verification.

4. Point the clients at the deployed HTTPS URL: `EXPO_PUBLIC_API_URL` in `frontend/.env`, `VITE_API_URL` in `admin/.env` (or use the per-environment client scripts — see `../README.md`, "Environments").

Migrations run in the pre-deploy step, so they happen once per deploy rather than racing across workers. Uploads still fall back to local disk unless `S3_BUCKET` is set — and container filesystems are ephemeral, so avatars do not survive a redeploy until object storage is configured (see `../shipping.md`).

### Staging environment

Add a second Railway **environment** for testing so `smoke_test.sh` and manual clicking never touch production data. In the dashboard, environment dropdown → **+ New Environment → Duplicate** `production`, name it `staging`. Duplicating copies the services and variables but **not** database data, so staging comes up with its own empty Postgres and Redis. Because `DATABASE_URL`/`REDIS_URL` are references (`${{Postgres.DATABASE_URL}}`, `${{Redis.REDIS_URL}}`), they resolve to staging's own databases automatically — no re-wiring. Approve the staged changes to deploy; the pre-deploy `alembic upgrade head` builds staging's schema.

To test against it: point the clients at the staging URL (`make frontend-staging` / `make admin-staging` from the repo root), or run the smoke test locally against staging's **public** DB/Redis URLs:

```bash
export AUTH_DEV_MODE=1
export DATABASE_URL='<staging Postgres DATABASE_PUBLIC_URL>'
export REDIS_URL='<staging Redis REDIS_PUBLIC_URL>'
alembic upgrade head
uvicorn app.main:app --port 8001
./smoke_test.sh http://127.0.0.1:8001   # junk rows land in disposable staging
```

Optionally set staging's service to deploy from a `staging` git branch (Settings → Source) so `main` stays production. Staging runs its own API + Postgres + Redis, so it roughly doubles resource use while up — delete and re-duplicate it when idle if cost matters (it holds no data you need).
