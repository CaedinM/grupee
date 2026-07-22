# WhereTheyAt backend

REST backend for **WhereTheyAt**, a festival friend-finder. iOS clients register a user, report their GPS position every ~1.5 s, and poll their group's locations every ~2 s. Events (festivals) hold a shared boundary polygon and landmark pins that groups can link to.

FastAPI · SQLAlchemy 2.0 (sync) · Pydantic v2 · SQLite locally, PostgreSQL in production.

## Run locally

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# DATABASE_URL is optional — defaults to sqlite:///./WhereTheyAt.db
# Auth needs CLERK_PUBLISHABLE_KEY in .env (see .env.example), or use
# AUTH_DEV_MODE=1 to skip token verification for local dev:
uvicorn app.main:app --reload
```

The API is at http://127.0.0.1:8000 — interactive docs at http://127.0.0.1:8000/docs. Tables are created automatically on startup (`create_all`; Alembic is the upgrade path when the schema needs migrations).

To use Postgres instead, copy `.env.example` to `.env` and set `DATABASE_URL` to your connection string.

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

## Deploy (Railway / Render)

Push this `backend/` directory, provision a managed Postgres, and set the service's `DATABASE_URL` env var to its connection string (a `postgresql://...` URL) plus `CLERK_PUBLISHABLE_KEY` (use the `pk_live_...` key from a Clerk production instance). Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Nothing else is needed — tables are created on first boot, and the same code runs unchanged against SQLite and Postgres.
