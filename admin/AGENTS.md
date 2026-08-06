# AGENTS.md — Grupee Ops console

## Keep this file current

When a change alters something described here — the auth/admin gate, the `Shell`
view state machine, the api-client shape, the env vars, or the map/geofence
model — update the relevant bullet in the same change. A stale invariant here is
worse than none, because the next agent will trust it.

## What this is

The **operator console** for Grupee — a Vite + React single-page app where
festival admins create events, draw geofence boundaries, place landmarks, and
schedule sets. It is a separate package from the phone app (`../frontend`) and
the backend (`../backend`); the three meet only at the HTTP contract in
`../backend/CLAUDE.md`. This app is the *authoring* side: everything it writes
(events, landmarks, sets) is the cold, admin-owned data the phone app reads.

Stack: Vite 8 · React 19 · TypeScript · Clerk (`@clerk/clerk-react`) · Leaflet /
`react-leaflet` for the maps · oxlint. No router library, no state library, no
component framework — plain `useState`/`useEffect` and hand-rolled CSS in
`src/index.css`.

## Commands

```bash
npm run dev            # Vite dev server; backend URL from .env (VITE_API_URL)
npm run dev:staging    # …forced at the Railway staging backend (--mode staging)
npm run dev:prod       # …forced at the Railway production backend (--mode production)
npm run build          # tsc -b + vite build (production mode)
npm run build:staging  # tsc -b + vite build against the staging backend
npm run lint           # oxlint
npx tsc -b             # typecheck only — the gate; run before calling a change done
```

There is no test suite. `tsc -b` (also run by `build`) plus `oxlint` are the
checks. Which backend a run targets is `VITE_API_URL`; see the env bullet and
`../README.md` (staging vs production flows).

## Architecture

Entry `src/main.tsx` mounts `ClerkProvider` (dark theme matching the phone app's
palette) → `App`. `App` splits on Clerk auth: `<SignedOut>` shows `LoginPage`
(Clerk `<SignIn routing="hash">` — hash routing so the email-code / reset
sub-flows work without a router), `<SignedIn>` shows `AdminGate`.

Screens live flat in `src/`, one component per file: `App.tsx` (auth gate +
`Shell` + event list), `CreateEvent.tsx` (the event/landmark/geofence editor,
the one big multi-step flow), `GeofenceMap.tsx` (the Leaflet map + polygon
drawing), `EventSets.tsx` (the set-schedule calendar), `EventDashboard.tsx`
(read-only event overview). Every network call goes through `src/api.ts`.

Cross-file invariants that matter when changing things:

- **Admin-ness is decided by the backend, not Clerk.** `AdminGate` (`App.tsx`)
  calls `getMe(token)` and branches on the local row's `is_admin`, not on any
  Clerk role or metadata. Its states are `loading` → then one of: `ready`
  (is_admin true → `Shell`), `denied` (signed in, profile exists, not an admin),
  `no-profile` (getMe 404 — the account has never provisioned a Grupee
  profile), or `error` (backend unreachable). `is_admin` is granted **only by a
  direct database update** — there is no endpoint and no self-serve toggle
  (any client can claim any user_id, so a toggle would make everyone an admin).
  Don't add one.
- **A profile is provisioned by the phone app, not here.** `POST /users` is the
  phone client's job; the console only ever *reads* `/users/me`. So the
  `no-profile` path deliberately tells the operator to sign into the phone app
  once with that Clerk account, then grant admin in the DB, then come back — the
  console cannot bootstrap its own row.
- **`src/api.ts` is the only place that calls `fetch`.** It owns `BASE_URL`
  (`import.meta.env.VITE_API_URL ?? "http://localhost:8000"`), the `ApiError`
  type carrying the backend's `detail` string, and every request/response type.
  Unlike the phone app's api layer, **every function takes the Clerk token as an
  explicit first argument** — there is no registered token-getter. Callers get
  `getToken` from `useAuth()` and thread it down as a prop (`Shell`, `CreateEvent`,
  `EventSets` all receive `getToken`), calling it per request so the short-lived
  session JWT is always fresh. Keep new endpoints in this file and follow the
  token-as-argument shape.
- **No router — navigation is a `View` union in `Shell`** (`App.tsx`):
  `list | dashboard | sets | create | edit`, switched with `setView`. The only
  routing library in the app is Clerk's hash routing on the sign-in card. Don't
  add React Router; extend the union.
- **The event list is bucketed by schedule phase.** `groupEvents`/`phaseOf`
  (`App.tsx`) sort events into `live | upcoming | past | unscheduled` from
  `starts_at`/`ends_at`; an event missing either timestamp is `unscheduled`
  (its own bucket, never on the timeline). A 30s `now` tick re-evaluates phases
  while the page sits open, mirroring the phone app's liveness model. This is the
  same rule the backend's `has_ended()` and the phone app's `useEventLiveness`
  enforce — keep the three in step.
- **Datetime fields are local-zone in the UI, ISO-UTC on the wire.** `<input
  type="datetime-local">` values are the operator's local time; `CreateEvent`
  and `EventSets` convert to/from ISO-8601 UTC at the api boundary (`toLocalInput`
  and the inverse). The backend stores everything UTC (`TZDateTime`). Never send a
  raw datetime-local string to the API or render a raw ISO string in an input.
- **Geometry is `[lat, lng]` everywhere**, matching the backend's boundary point
  order and Leaflet's `LatLng`. `GeofenceMap` draws boundary polygons of
  `MIN_POINTS`(3)–`MAX_POINTS`(200) vertices for both the event boundary and
  per-landmark geofences; landmark pins are emoji `divIcon`s keyed by kind via
  `LANDMARK_META`/`landmarkEmoji` in `api.ts`. Tiles are CARTO dark (default) or
  Esri satellite. If you touch the point model, keep event boundary and landmark
  boundary — both `LatLng[]` — consistent.
- **`LANDMARK_KINDS` here is a deliberate subset** (`entrance`, `exit`,
  `restroom`, `stage`) of what the backend accepts (it also takes `food`,
  `drinks`, `medical`, …). Only stages carry an operator-supplied `name`; the
  generic kinds are labelled server-side. Widening the console's kinds is a
  UI-only change — the backend already accepts them.
- **Styling is one hand-written stylesheet** (`src/index.css`) with the phone
  app's dark palette (`#101014` background, `#1c1c22` surfaces, `#5b5bf0` accent,
  `#ff6b6b` errors) plus the Ops "control-room" chrome (mono status tags, the
  `OPS` badge). Clerk components are themed once in `main.tsx` so the sign-in card
  matches without per-component overrides. There is no CSS framework or CSS-in-JS;
  add classes to `index.css`.

## Auth & environment

- **Env vars** (Vite only exposes `VITE_`-prefixed ones to the client):
  `VITE_CLERK_PUBLISHABLE_KEY` (required — `main.tsx` throws without it; same Clerk
  instance and key as the phone app and backend) and `VITE_API_URL` (the backend
  base; unset falls back to `http://localhost:8000`). The Clerk key lives in the
  gitignored `.env`; the backend URL per environment lives in the committed
  `.env.staging` / `.env.production` (public URLs, no secrets), which
  `--mode staging` / `--mode production` load on top of `.env`. See `../README.md`.
- **Not yet deployed.** Only the backend + Postgres + Redis run on Railway so far;
  the console is run locally against a deployed backend. When it does ship, it's a
  static `vite build` (host anywhere) with `VITE_API_URL` baked in per environment
  — CORS on the backend is currently `*` and would want tightening to the
  console's origin at that point (tracked in `../shipping.md`).
