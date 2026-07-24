# WhereTheyAt?

A festival friend-finder. Your crew joins a group tied to a festival, and while that
festival is live everyone's position shows up on a shared map.

- **Groups** are crews — create one against a festival, share the 4-letter join code.
- **Events** are the festivals: schedule, boundary polygon, landmark pins.
- **A group's life is its event's life.** Location streams only while the event is live;
  finished groups stay readable as history.

Positions are polled, not pushed: GPS PUT every ~1.5s, group locations GET every ~2s.
Only the latest position per user is stored — no history.

## Monorepo structure

```
backend/     FastAPI — SQLite locally, hosted Postgres on Railway
frontend/    Expo / React Native app - the user client
admin/       Vite + React Ops console
```

Three standalone packages, no workspace tooling; they meet at the HTTP contract.

| File | What it covers |
|---|---|
| `backend/README.md` | API overview, auth, deploy |
| `backend/CLAUDE.md` | backend architecture + invariants |
| `frontend/AGENTS.md` | app architecture, poll intervals, state ownership |

## Tech stack

- **Backend:** FastAPI, SQLAlchemy 2.0, Alembic; SQLite locally, Railway Postgres in prod
- **Frontend:** Expo SDK 54 / React Native 0.81
- **Admin App:** Vite 8, React 19
- **Auth:** Clerk
- **DevTools:** Claude Code (Fable 5 + Opus 4.8), Cursor

## Dev setup

Needs Python 3.11+, Node 20+, and Expo Go (or an iOS simulator).

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # set CLERK_PUBLISHABLE_KEY
alembic upgrade head          # build the schema
uvicorn app.main:app --reload --host 0.0.0.0
```

Docs at http://127.0.0.1:8000/docs. Bind `0.0.0.0` so a phone on the same Wi-Fi can reach
it. `rm WhereTheyAt.db && alembic upgrade head` resets local state — Alembic owns the
schema, the app creates nothing at startup. `AUTH_DEV_MODE=1` skips token verification for
keyless dev — never in prod. `./smoke_test.sh` (against a dev-auth server) is the test suite.

### Frontend

```bash
cd frontend
npm install
# .env: EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
#       EXPO_PUBLIC_API_URL=...  (optional; defaults to the Expo dev-server host)
npm start        # scan the QR with Expo Go — also: npm run ios / npm run web
npx tsc --noEmit # the only automated check
```

Expo reads `.env` at startup only, so a key change needs a restart. Pinned to SDK 54 until
Expo Go ships 57.

### Admin

```bash
cd admin
npm install
# .env: VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
#       VITE_API_URL=http://127.0.0.1:8000
npm run dev      # also: npm run build / npm run lint
```

Event writes require being the event's creator or a platform admin (`users.is_admin`,
granted only by direct DB update).
