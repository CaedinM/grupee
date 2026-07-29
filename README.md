# Grupee

Music festival comapnion app. Track your friends, view set-times and track your activity throughout the day all in one place.

- **Groups** create a group, select a festival, share the 4-letter join code.
- **Events** are the festivals: schedule, boundary polygon, landmark pins.
- **A group's life is its event's life.** Location streams only while the event is live;
  finished groups stay readable as history.

Positions are published to backend via FastAPI Websockets.
Only the latest position per user is stored — no history. Live positions live in **Redis**
(TTL'd, latest-only), never in the SQL database; everything else is Postgres.

## Repo structure

```
backend/     FastAPI — Postgres (local + Railway) + Redis for live positions
frontend/    Expo / React Native app - the user client
admin/       Vite + React Ops console
```

Three standalone packages, no workspace tooling; they meet at the HTTP contract.

## The Stack

- **Backend:** FastAPI, SQLAlchemy 2.0
- **Frontend:** Expo / React Native
- **Admin Console:** Vite, React
- **DB:** Postgres, Redis
- **Auth:** Clerk
- **DevTools:** Claude Code (Fable 5 + Opus 4.8), Cursor
- **Cloud Services:** Railway, Cloudflare R2 (Object Storage)


# Setup (first time, after cloning)

Do this once per machine to get all three packages ready to run.

### Prerequisites

- **Python 3.11+** and **Node 20+**
- **Homebrew** (macOS) — for Postgres and Redis (no Docker needed)
- The **Expo Go** app on your phone, or **Xcode** for the iOS simulator
- The **Clerk publishable key** (`pk_test_…`) — the *same* value for all three packages;
  from the Clerk dashboard → API Keys, or from a teammate

### 1. Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Postgres + Redis — one-time install; brew services auto-starts them at every login
brew install postgresql@14 redis
brew services start postgresql@14 && brew services start redis
createdb wheretheyat_dev

cp .env.example .env          # then fill it in (see "Env files" below)
alembic upgrade head          # build the schema
```

### 2. Frontend

```bash
cd frontend
npm install
# create frontend/.env (see below). Pinned to Expo SDK 54 until Expo Go ships 57.
```

### 3. Admin

```bash
cd admin
npm install
# create admin/.env (see below).
# .env.staging / .env.production already exist (committed) — they hold the backend URLs.
```

### Env files to create

All three are **gitignored**. The Clerk publishable key is identical in all of them.

| File | Required | Optional |
|---|---|---|
| `backend/.env` | `CLERK_PUBLISHABLE_KEY=pk_test_…`<br>`DATABASE_URL=postgresql://<you>@localhost:5432/wheretheyat_dev` | `REDIS_URL` (default `redis://localhost:6379/0`), `LOG_LEVEL` |
| `frontend/.env` | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_…` | `EXPO_PUBLIC_API_URL` — **leave unset** for local dev (the env scripts handle staging/prod) |
| `admin/.env` | `VITE_CLERK_PUBLISHABLE_KEY=pk_test_…` | `VITE_API_URL` — leave unset for local dev |

`<you>` is your macOS username (Homebrew Postgres uses trust auth, no password).
`backend/.env.example` documents every backend variable.

> **Leave the API-URL var out of the client `.env` files.** If `EXPO_PUBLIC_API_URL` /
> `VITE_API_URL` is set there it overrides *everything*, including `npm start` / `npm run
> dev`, and pins that client to one backend. The per-environment scripts below are the
> intended way to choose a backend.

---

# Running the app

The clients bake in **one backend URL per run**, chosen by which command you use:

| | Local backend | Staging | Production |
|---|---|---|---|
| **Frontend App** (Expo) | `npm start` | `npm run start:staging` | `npm run start:prod` |
| **Admin Platform** (Vite) | `npm run dev` | `npm run dev:staging` | `npm run dev:prod` |

Confirm the live target any time in the app's **Profile tab** (it prints the base URL).

## Local dev — everything on your machine, in Expo Go

Postgres and Redis are already running (they auto-start at login — check with
`brew services list`). The backend does **not** start them; it just connects. You need
two terminals:

```bash
# Terminal 1 — backend. --host 0.0.0.0 so your phone can reach it over Wi-Fi.
cd backend && source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0

# Terminal 2 — the phone app
cd frontend && npm start          # then scan the QR code with Expo Go
```

With `EXPO_PUBLIC_API_URL` unset, the app derives your Mac's LAN IP from the Expo dev
server and hits your local backend on `:8000` — so **your phone and Mac must be on the
same Wi-Fi**. (The iOS simulator uses `localhost` and needs no Wi-Fi: press `i` in the
Expo terminal.)

For the admin console against the same local backend (separate terminal):

```bash
cd admin && npm run dev           # http://localhost:5173 → talks to localhost:8000
```

Auth is real Clerk in local dev (the app sends real tokens, the backend verifies them).
Reset local data anytime:

```bash
dropdb wheretheyat_dev && createdb wheretheyat_dev && alembic upgrade head   # SQL
redis-cli flushall                                                           # live positions
```

Backend test suite (walks the full acceptance flow) — needs a dev-auth server:

```bash
AUTH_DEV_MODE=1 uvicorn app.main:app --reload   # one terminal
./smoke_test.sh                                 # another
```

`AUTH_DEV_MODE=1` skips Clerk verification — **dev/test only, never deployed.**

## Staging — clients against the deployed staging backend

No local backend needed; staging runs on Railway with its own **throwaway** Postgres +
Redis, so you can poke at it freely without touching production.

```bash
cd frontend && npm run start:staging   # Expo Go → staging (scan the QR)
cd admin    && npm run dev:staging     # browser → staging
```

Staging's databases start **empty**, so the first time you point there: sign into the
admin console and **create an event** before the phone app can create a group against it,
and your phone profile re-registers via the name screen (no user row exists yet).

## Production — clients against the live backend (avoid for testing)

Devs shouldn't test against production — its data is real users. But when you need to
verify a release or reproduce a reported bug, the clients reach it the same way:

```bash
cd frontend && npm run start:prod      # Expo Go → production
cd admin    && npm run dev:prod        # browser → production
```

**Never** run `smoke_test.sh` against production — it writes throwaway users, groups, and
events into live data. Use local or staging for that.

> **How real users get the app** is a separate thing entirely — it's a native app, not a
> URL, so it ships through TestFlight / the App Store via EAS Build. That's not set up yet;
> see the **Distribution** section in `shipping.md`.

## How the backend switch works (reference)

- **Frontend** (Expo has no `--mode`): `start:staging` / `start:prod` set
  `EXPO_PUBLIC_API_URL` **inline** in the script and pass `--clear`. The `--clear` is
  required — the URL is inlined into the JS bundle and Metro caches it, so switching
  environments without clearing keeps hitting the old host. Plain `npm start` uses
  `frontend/.env`, falling back to the Expo dev-server's LAN IP when the var is unset.
- **Admin** (Vite `--mode`): `dev:staging` / `dev:prod` load `admin/.env.staging` /
  `admin/.env.production` (committed, backend URL only — no secrets) on top of `admin/.env`
  (gitignored, holds the Clerk key). Plain `npm run dev` uses `admin/.env` (localhost when
  the URL is unset).

The Railway side — creating the staging environment and the
`${{Postgres.DATABASE_URL}}` / `${{Redis.REDIS_URL}}` references — is in `backend/README.md`.
