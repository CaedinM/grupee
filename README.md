# WhereTheyAt?

A festival friend-finder. You and your crew join a group tied to a festival, and for as
long as that festival is running everyone's live position shows up on a shared map — so
finding each other in a field of 40,000 people stops being a lost cause.

The shape of it:

- **Groups** are crews. One person creates a group against a festival and gets a 4-letter
  join code; everyone else joins with that code.
- **Events** are the festivals themselves — a name, a schedule, a boundary polygon, and
  landmark pins (stages, gates, meeting points) that every group at that event sees.
- **A group's life is its event's life.** Location only streams while the event is live,
  so nobody gets tracked between festivals. Finished groups stay readable as history.

Positions are polled, not pushed: clients PUT their GPS every ~1.5s and GET the group's
locations every ~2s. There is no location history — the backend keeps exactly one latest
position per user.

## Monorepo structure

```
where-they-at/
├── backend/     FastAPI REST API — users, groups, events, landmarks, uploads
├── frontend/    Expo / React Native app (iOS) — the thing festival-goers use
└── admin/       Vite + React ops console (desktop web) — create events, draw geofences
```

Three independent packages, no workspace tooling — each is installed and run on its own.
They meet at the HTTP contract: `backend/README.md` has the endpoint table, and both
clients funnel every request through their own `src/api.ts`.

Per-package docs worth reading before changing code:

| File | What it covers |
|---|---|
| `backend/README.md` | API overview, auth, deploy |
| `backend/CLAUDE.md` | backend architecture + invariants |
| `frontend/AGENTS.md` | app architecture, poll intervals, state ownership |
| `initial_backend_spec.md` | the original product/API spec |
| `shipping.md` | release notes / shipping checklist |

## Tech stack

**Backend** — Python, FastAPI, SQLAlchemy 2.0 (synchronous, deliberately), Pydantic v2.
SQLite locally, PostgreSQL in production, from the same code. Uploads go to S3 (or any
S3-compatible service) in production and local disk in dev, behind `app/storage.py`. No
Alembic yet — tables are created on startup.

**Frontend** — Expo SDK 54 / React Native 0.81, React 19, TypeScript. `react-native-maps`
for the map, `expo-location` for GPS, `react-native-web` for a degraded browser build used
for quick UI checks. No navigation library — `App.tsx` is the whole shell.

**Admin** — Vite 8, React 19, TypeScript, Leaflet / react-leaflet for drawing geofence
polygons, Oxlint.

**Auth** — [Clerk](https://clerk.com) across all three (email + password, email-code
verification). Clients send Clerk's session JWT as `Authorization: Bearer`; the backend
verifies it against Clerk's JWKS and maps `sub` → `users.clerk_id`. All three share the
same publishable key.

## Dev setup

Prerequisites: Python 3.11+, Node 20+, and the Expo Go app on an iPhone (or an iOS
simulator) for the frontend.

### 1. Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # set CLERK_PUBLISHABLE_KEY
uvicorn app.main:app --reload --host 0.0.0.0
```

API at http://127.0.0.1:8000, interactive docs at `/docs`. `DATABASE_URL` defaults to
SQLite and tables are created on first boot — `rm WhereTheyAt.db` resets local state.

Bind to `0.0.0.0` so a phone on the same Wi-Fi can reach it.

Keyless option: `AUTH_DEV_MODE=1 uvicorn app.main:app --reload` skips token verification
and takes any bearer token verbatim as a Clerk user id. Never set it in production.

End-to-end check (server must be running with `AUTH_DEV_MODE=1`):

```bash
./smoke_test.sh               # or ./smoke_test.sh http://host:port
```

That is the test suite — there is no pytest, linter, or build step.

### 2. Frontend

```bash
cd frontend
npm install
```

Create `frontend/.env`:

```
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:8000   # optional
```

`EXPO_PUBLIC_API_URL` is optional — without it the base URL is derived from the Expo
dev-server host, so a changing LAN IP just works. Expo reads `.env` only at startup, so
a key change needs a restart.

```bash
npm start        # scan the QR code with Expo Go
npm run ios      # simulator
npm run web      # browser; no real map, renders a telemetry list instead
npx tsc --noEmit # the only automated check — run it before calling a change done
```

Pinned to SDK 54 because the App Store build of Expo Go does not support SDK 57 yet.

### 3. Admin console

```bash
cd admin
npm install
```

Create `admin/.env`:

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
VITE_API_URL=http://127.0.0.1:8000
```

```bash
npm run dev      # Vite dev server
npm run build    # tsc -b && vite build
npm run lint     # oxlint
```

Event writes require being the event's creator or a platform admin. `users.is_admin` is
granted only by a direct database update — there is no UI for it.
