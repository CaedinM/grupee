# Grupee backend

FastAPI service for Grupee. Postgres stores durable product data; Redis stores expiring live
locations and WebSocket pub/sub state.

## Operations

Read [`../SETUP.md`](../SETUP.md) for local development, staging, and production operations.
The local API runs at http://127.0.0.1:8000, with interactive documentation at
http://127.0.0.1:8000/docs.

## Schema migrations

Alembic owns the schema; the app creates no database tables at startup. After changing
`app/models.py`:

```bash
alembic revision --autogenerate -m "what changed"
alembic upgrade head
alembic check
```

Review generated revisions. `TZDateTime` must render as `sa.DateTime(timezone=True)`, and
`alembic/env.py` takes `DATABASE_URL` from `app.database`, not `alembic.ini`.

## Authentication

Clerk owns identity. Clients send a Clerk session JWT as `Authorization: Bearer <token>`;
the backend verifies it and maps its `sub` to `users.clerk_id`. Every route except `/health`
requires authentication. `AUTH_DEV_MODE=1` accepts test bearer tokens only for local smoke tests.

## Tests

`smoke_test.sh` exercises the end-to-end backend flow. It needs `make backend-dev` running in
another terminal. `test_dwell_rules.py` contains the set-attendance unit checks.

## API overview

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness check |
| POST | `/users` | Provision the signed-in account profile |
| GET | `/users/me` | Read the signed-in account profile |
| PATCH | `/users/{id}` | Rename a profile |
| PUT / DELETE | `/users/{id}/avatar` | Manage a profile picture |
| PUT | `/users/{id}/location` | Report a latest location |
| GET | `/users/{id}/groups` | List a user's groups |
| POST | `/groups` | Create a group and join code |
| GET | `/groups/{id}` | Read group metadata and members |
| GET | `/groups/by-code/{code}` | Preview a group |
| POST | `/groups/{code}/members` | Join a group by code |
| GET | `/groups/{id}/locations` | Read member locations |
| DELETE | `/groups/{id}/members/{user_id}` | Leave a group |
| POST / GET | `/events` | Create or list festivals |
| GET | `/events/{id}` | Read a festival and boundary |
| GET | `/events/{id}/map` | Read a festival boundary and landmarks |
| PUT | `/events/{id}/boundary` | Set an event boundary |
| POST / GET | `/events/{id}/landmarks` | Manage landmarks |
| DELETE | `/events/{id}/landmarks/{lid}` | Remove a landmark |

Event writes are available to the event creator and platform admins. The complete API contract
is implemented in `app/routers/` and documented by the local OpenAPI endpoint.
