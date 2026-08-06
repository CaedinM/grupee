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

---

# Setup

Once per machine.

**You need:** Python 3.11+, Node 20+, Homebrew, Xcode, an Expo account, and the Clerk
publishable key (`pk_test_…` — Clerk dashboard → API Keys, same value everywhere).

```bash
# 1. Databases — one-time; brew auto-starts them at every login
brew install postgresql@14 redis
brew services start postgresql@14 && brew services start redis
createdb wheretheyat_dev

# 2. Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head

# 3. Clients
cd ../frontend && npm install
cd ../admin && npm install
```

**Create three `.env` files** — all gitignored, same Clerk key in each:

| File | Contents |
|---|---|
| `backend/.env` | `CLERK_PUBLISHABLE_KEY=pk_test_…`<br>`DATABASE_URL=postgresql://<you>@localhost:5432/wheretheyat_dev` |
| `frontend/.env` | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_…` |
| `admin/.env` | `VITE_CLERK_PUBLISHABLE_KEY=pk_test_…` |

`<you>` is your macOS username (Homebrew Postgres uses trust auth, no password).
**Don't set `EXPO_PUBLIC_API_URL` or `VITE_API_URL`** — they override everything and pin that
client to one backend.

### Install the iOS dev client

The app does **not** run in Expo Go — background location needs a native task Expo Go can't
run. Build the dev client once:

```bash
cd frontend
npx eas build --profile development-simulator --platform ios
# then, from the artifact URL it prints:
tar -xzf <artifact>.tar.gz
xcrun simctl install booted Grupee.app
```

Rebuild **only** when `app.json` or a native dependency changes. JS changes just need Metro.

### Clerk JWT template

Clerk dashboard → **JWT Templates** → new template named `background`, lifetime `43200`,
claims `{"scope": "bg-location"}`. This is what lets the app report location while minimized;
without it everything works but background tracking stays off.

---

# Running it

All from the repo root. `make <package>` is local, `make <package>-staging` is deployed
staging. Run `make` on its own to list everything.

### Local — three terminals

```bash
make backend     # FastAPI on :8000
make frontend    # Metro — press i for the simulator
make admin       # admin console on :5173
```

### Staging — no local backend needed

```bash
make frontend-staging
make admin-staging
```

Staging is Railway with its own throwaway Postgres + Redis, so poke at it freely. Its database
starts **empty**: first time you point at it, open the admin console, grant yourself admin
there, and create an event — the app can't make a group without one.

### Production — admin console only

```bash
cd admin && npm run dev:prod
```

That's the **only** command that touches production, and it's for creating real festivals, not
testing. The app itself can't reach prod from a dev machine at all — there's no `start:prod`
script, and users get the app through TestFlight (`eas build --profile production`, see
`shipping.md`). Never run `smoke_test.sh` against prod; it writes junk users and events.

### Everything else

| Command | What it does |
|---|---|
| `make reset` | Wipe the DB + Redis and re-migrate — clean slate |
| `make users` | List users (where you find your `clerk_id`) |
| `make grant-admin CLERK_ID=user_xxx` | Required to get into the admin console |
| `make migrate` | Apply new migrations without wiping data |
| `make verify` | Typecheck both clients |
| `make smoke` | Backend e2e test (needs `make backend-dev` in another terminal) |

Auth is real Clerk everywhere. Signing in against an empty DB drops you on the name screen and
provisions your user — so `make reset` is also how you re-test the first-login flow. Confirm
which backend a client is hitting in the app's **Profile tab** (it prints the URL).

---

# Reference

**Choosing a backend.** `start:staging` sets `EXPO_PUBLIC_API_URL` inline and passes `--clear`
— required, because the URL is baked into the JS bundle and Metro caches it. The admin's
`dev:staging` loads the committed `admin/.env.staging`. Plain `npm start` / `npm run dev` use
your local backend. Railway setup lives in `backend/README.md`.

**Adding a frontend dependency.** EAS builds on Node 20 / npm 10; this machine runs Node 24 /
npm 11, and npm 11 can write a lockfile npm 10 rejects — the build then fails in "Install
dependencies" while `npm ci` passes locally. Verify with `npx npm@10 ci` in a scratch copy of
`package.json` + `package-lock.json`, and regenerate with
`npx npm@10 install --package-lock-only` if it fails.

**Testing background location.** Needs a stage geofence and a set spanning now (draw both in
the admin console), plus a lowered `SEEN_DWELL_SECONDS` so a credit lands in seconds. On the
simulator use **Features → Location → City Run**: a *static* location produces no updates at
all, because `distanceInterval` only fires on movement.
