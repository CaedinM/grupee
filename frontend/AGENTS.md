# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

This project is pinned to SDK 54 because the App Store build of Expo Go does not yet
support SDK 57. Once Expo Go 57 ships, upgrade with `npm install expo@^57 && npx expo install --fix`
and bump the docs URL above back to v57.0.0.

## Keep this file current

When a change alters something described here — the state that lives in `App.tsx`, the
group/event lifecycle, a poll interval, the API layer's shape, or a new screen or hook —
update the relevant bullet in the same change. A stale invariant here is worse than no
invariant, because the next agent will trust it.

## What this is

The WhereTheyAt client: an Expo / React Native app for a festival friend-finder. iOS via
Expo Go is the real target; `npm run web` (react-native-web) exists for quick UI checks and
gets a degraded map. Backend contract and the hot paths it cares about are in
`../backend/CLAUDE.md`; the product spec is `../spec.md`.

## Commands

```bash
npm start          # Expo dev server; backend URL from .env (or LAN fallback)
npm run start:staging  # …forced at the Railway staging backend (clears Metro cache)
npm run start:prod     # …forced at the Railway production backend (clears Metro cache)
npm run ios        # simulator
npm run web        # browser (no real map — see the platform-split bullet)
npx tsc --noEmit   # the only automated check in this package
```

There is no test suite, linter, or build step. `npx tsc --noEmit` is the gate — run it
before calling a change done. `.env` holds `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and the
optional `EXPO_PUBLIC_API_URL`; Expo only reads it at start, so a key change needs a restart.

**Which backend a run targets** is `EXPO_PUBLIC_API_URL`. Expo has no arbitrary `--mode`,
so `start:staging` / `start:prod` set that var **inline** in the script (an inline env var
wins over `.env` in Expo's loader) and pass `--clear` — required, because the URL is inlined
into the bundle and Metro caches it, so switching environments without clearing keeps serving
the old host. Plain `npm start` uses whatever `.env` says, and falls back to the Expo
dev-server's LAN IP (`resolveBaseUrl` in `src/api.ts`) when the var is unset. Confirm the live
value in the app's **Profile tab** (`ProfileScreen.tsx` renders `BASE_URL`). The full staging
vs production story — including the parallel `admin` scripts — is in `../README.md`.

## Architecture

`App.tsx` is the whole shell — there is no navigation library. It nests
`ClerkProvider` → `Root` (auth gate) → `ProfileGate` (backend profile) → `SignedInApp`
(tabs + shared state). Screens and hooks live in `src/`; every network call goes through
`src/api.ts`. The groups tab is the one multi-step flow, so it gets its own folder:
`src/groups/GroupsScreen.tsx` holds the `Mode` state machine and its one step per file
(`Chooser`, `CreateForm`, `JoinForm`, `CodeReveal`, `GroupView`), with `BackLink` /
`CodeBadge` as shared leaves and `events.ts` for the event helpers.

Cross-file invariants that matter when changing things:

- **`src/api.ts` is the only place that calls `fetch`.** It owns the base URL (derived from
  the Expo dev-server host so a changing LAN IP just works), the `ApiError` type that
  carries FastAPI's `detail` string, and every request/response type. Screens import
  functions from it; they never build URLs.
- **The Clerk token getter is registered during render in `Root`, not in an effect.** Child
  effects fire before parent effects on mount, so an effect there would let the first API
  calls go out unauthenticated. Don't "clean this up" into a `useEffect`.
- **`SignedInApp` owns the cross-screen state**: `activeGroup` (mirrored up from
  `GroupsScreen` via `onGroupChange`), `liveness`, and `reporting`. Screens receive them as
  props. Resolve shared state once here rather than re-polling it per screen.
- **Event liveness is the single gate on tracking.** `useEventLiveness(activeGroup)` runs
  once in `App.tsx` and its result is passed to both `MapScreen` and `GroupsScreen`. The
  `live` flag gates both sides of the location socket — `useLocationSocket` only connects,
  and `useLocationReporting` only sends, while the status is `"live"` — so nobody streams or
  is streamed to between festivals. The backend independently rejects a socket for an ended
  event (close 4409), so the gate is enforced on both ends now. Groups with no `event_id`, or
  events with no schedule, count as live so pre-admin-tool rows keep working.
- **A group's life ends with its event, and the split is mostly the client's job.** The
  backend enforces expiry on the two write paths only — creating a group against a finished
  event and joining one both 409, each mapped to fixed copy in `CreateForm` / `JoinForm`
  rather than shown from the server's `detail`. Every read still returns finished groups,
  and `GET /users/{id}/groups` returns every membership forever, which is what makes group
  history renderable. `GroupsScreen`
  derives the split: at load it fetches groups and `listEvents()` together and files any
  group whose event's `ends_at` has passed under "My previous groups", picking the first
  remaining group as active; while open, a liveness flip to `"ended"` retires the active
  group into that same list and drops the user back on the create/join chooser. Both paths
  must keep working — the first covers events that ended while the app was closed, the
  second covers ones that end during a session. The create-group event picker filters to
  the same definition (`hasNotEnded`, in `src/groups/events.ts`), so a finished festival is
  never offered as an option.
- **All three screens stay mounted**, hidden with `display: "none"` rather than unmounted,
  so the map keeps its camera position across tab switches. Anything expensive in a screen
  must therefore be gated on props, not on mount. A corollary for animation: an entrance
  transition on a tab screen's root only ever plays once, at app start, so `Reveal` belongs
  on things that genuinely mount — the groups flow's steps, the settings sheet, a list
  re-keyed on a filter — not on the tab screens themselves.
- **The tab bar floats over the screens; it does not reserve a row.** `TabBar` is rendered
  into an absolutely-positioned layer at the bottom of `SignedInApp` with
  `pointerEvents="box-none"`, so every screen runs full-bleed to the bottom of the display
  and the map reaches the bottom edge with the capsule hovering in front of it. The cost is
  that the bar *occludes*: every screen owes itself `useTabBarClearance()` (exported from
  `TabBar.tsx`) worth of bottom padding — as `contentContainerStyle` padding on the
  scrollable screens, as `paddingBottom` on the fixed ones. `MapScreen`'s two bottom-anchored
  controls (`recenter`, `errorBanner`) take their `bottom` inline from the same hook, so the
  bar's height stays a one-constant change (`TAB_BAR_BASE`).
- **Platform split via filename**: `MapScreen.web.tsx` shadows `MapScreen.tsx` on web
  because `react-native-maps` has no web support, so web renders a telemetry list instead.
  A change to the map screen's props or empty states needs applying to both files.
- **Event-specific map overlays are gated on group membership.** The geofence boundary
  (from `liveness.event.boundary`) and the landmarks (from `useEventLandmarks`, which calls
  `listLandmarks(event_id)`) render only when the user is in a group and only for that
  group's own event — a groupless user or a group with no `event_id` sees neither. Both are
  shown regardless of liveness status (upcoming/live/ended) because they're wayfinding, not
  live position. Landmark pins are keyed by kind through `LANDMARK_ICONS` in `MapScreen.tsx`;
  the web variant lists them as telemetry rows. Keep both variants in step.
- **A landmark can carry its own geofence** (`Landmark.boundary`, a [lat, lng] polygon).
  When the user's position falls inside one, its name shows in a teal pill stacked under the
  group/event header pill (`headerStack` in `MapScreen.tsx`); the web variant surfaces the
  same as a "You're at:" telemetry line. `GroupView` reuses the same test to tag each
  member row with the landmark they're standing in (right-aligned, teal), joining
  `useGroupLocations` positions against `useEventLandmarks`. The containment test is shared:
  `pointInPolygon` / `landmarksContaining` in `src/geo.ts`, used by both map variants and the
  groups list — put any new map geometry there rather than inlining it in one file.
- **A stage pill shows who's playing while the event is live.** `useEventSets` (same
  event-scoped, group-gated fetch as `useEventLandmarks`, calling `listSets(event_id)`)
  supplies the schedule; `currentSetForLandmark(sets, landmarkId, now)` in `src/useEventSets.ts`
  picks the set whose half-open `[start, end)` window contains `now`. It's fetched only while
  liveness is `"live"` and rendered only for `kind === "stage"` landmarks the user is standing
  in: the native map appends the artist after the stage name in the landmark pill, the web
  variant appends it in parentheses on the "You're at:" line. `now` is re-read each render (the
  live location fix re-renders far finer than set boundaries need) — there's no separate tick.
- **Live stage pins are tappable (native map only).** Tapping any `LandmarkMarker` calls
  `onSelectStage`; for a `kind === "stage"` pin while liveness is `"live"` it opens an info
  bubble (current set's artist "Now playing", else next via `upcomingSetForLandmark` "Up next",
  else "No sets scheduled" — resolved by `stageCalloutFor`), any other pin just closes an open
  one. The bubble is NOT a native `Callout` — that flashed its custom content before animating
  and fought the ~1.5s location re-render. Instead `StageBubble` is a self-managed screen
  overlay: the press handler resolves the pin's pixel anchor via `mapRef.pointForCoordinate`,
  the bubble measures itself once while invisible, then fades/scales in above the pin, and it's
  dismissed instantly by the `MapView`'s `onPress`/`onPanDrag` (and on recenter / liveness or
  event change). The press handler reads live/sets from `stageDataRef` so it stays a stable
  callback. The web variant has no map, so there's nothing to mirror there.
- **Live location is a WebSocket, not a poll.** `useLocationSocket` (`src/useLocationSocket.ts`)
  owns one socket to the active group, resolved once in `SignedInApp` and its `members` array
  passed down as a prop to every consumer (`MapScreen`, `MapScreen.web`, `GroupView`) — there is
  no more `useGroupLocations` and no 2s locations GET. `useLocationReporting` no longer PUTs on a
  1.5s timer: it watches GPS with `distanceInterval: 5` (the OS delivers a fix only after ~5m of
  movement) and pushes each fix up the socket via `socket.send`, plus a **180s heartbeat** that
  resends the last fix so a stationary user stays live. `send` is fire-and-forget (no server echo),
  so `lastAck`/`sentCount` are synthesized locally, and the socket patches the self entry in
  `members` on each send. The socket reconnects with exponential backoff on transient drops but
  stops on terminal close codes (4403 not-a-member, 4404 no-group, 4409 event-ended). The backend's
  `PUT /users/{id}/location` and `GET /groups/{id}/locations` still exist as a fallback but the app
  doesn't call them. Keep `LOCATION_TTL_SECONDS` (backend, 210s) > the 180s heartbeat.
- **Poll intervals are deliberate and live next to their hook**: group members 5s, event refetch 60s,
  landmark refetch 60s and set refetch 60s (cold data — the interval is really the
  error-retry loop), liveness re-evaluation tick 30s. Polling loops guard with an `inFlight` flag and a
  `cancelled` flag in the cleanup; copy that shape rather than inventing a new one.
- **Cold, admin-authored data is cached on device, cache-first.** `useEventLiveness`,
  `useEventLandmarks`, and `useEventSets` fetch through `useCachedResource` (`src/useCachedResource.ts`),
  which renders the last-persisted value from AsyncStorage immediately (so the geofence, pins,
  and schedule show on a cold or offline open) then revalidates on the 60s loop above and
  re-persists. Keys are namespaced by event id (`wta.event.<id>`, `wta.landmarks.<id>`,
  `wta.sets.<id>`); passing a null key stands the whole thing down (no cache read, fetch, or
  interval), which is how the event-id gating still works. The hot paths (location PUT, group
  locations GET) are deliberately NOT cached — they're live per-user data. `ProfileGate`'s
  profile load in `App.tsx` predates this helper and stays hand-rolled (it interleaves a
  name-screen fallback), but new cold resources should use `useCachedResource`. Its cache is
  keyed per Clerk account (`wta.user.<clerkUserId>`) and self-invalidates: a 404 from the
  background `getMe()` refresh means the profile is gone server-side (account deleted, or the
  backend repointed at a fresh database), so the entry is dropped and the user falls to
  `NameScreen` to re-provision. Only 404 invalidates — offline/5xx keep the cache, which is
  what lets the app open without a network.
- **Avatars come back in two forms** — absolute URLs from S3, host-relative paths from
  local-disk dev storage. Always render them through `avatarUri` / `avatarSource`, which
  normalize both.
- **Everything outside the map is styled from the "Nightglass" system in `src/ui/`.**
  `theme.ts` holds the tokens (`color`, `glass`, `ramp`, `radius`, `space`, `type`, `font`,
  `shadow`) and `Glass.tsx` the primitives (`Aurora`, `GlassSurface`, `GlassCard`,
  `GlassButton`, `Reveal`, `PulseDot`, `usePressScale`). Compose those rather than
  hand-rolling a surface; per-file `StyleSheet.create` is still where layout and type live,
  but it should reference tokens instead of literals. `src/groups/styles.ts` stays shared by
  that folder for the same reason as before — those screens are steps in one flow.
- **The material only works because of the layers, so don't flatten them.** A pane is a
  `BlurView` + a near-transparent white wash + a `sheen` falling from the top edge + a
  specular hairline along the rim + a hairline border and a wide soft shadow. Drop the sheen
  and specular and it stops reading as glass and starts reading as a translucent box.
  Critically, **panes have no colour of their own**: `Aurora` is painted once in `App.tsx`
  behind the whole screen stack and is the only thing supplying hue, so a surface that sets
  an opaque `backgroundColor` punches a hole in the design.
- **The map is split into chrome and map, and only the chrome is themed.** Everything
  rendered *inside* `MapView` — the `AvatarMarker`s and their labels, `LandmarkMarker`'s
  badge and label, the boundary `Polygon` and its event label, `LANDMARK_ICONS` — keeps its
  own map-cartography palette (teal `#14b8a6` landmarks, orange members, indigo self, white
  text haloes) and is deliberately *not* on Nightglass tokens: those marks have to read
  against Apple's pale `mutedStandard` tiles, not against the Aurora. Everything overlaid on
  top of the map — the group/event and landmark pills, the upcoming/ended message cards, the
  error banner, the recenter button, the `StageBubble`, and the pre-GPS-fix waiting screen —
  is Nightglass glass. Keep that line when editing this screen.
- **Glass over the map needs `scrim`.** `GlassSurface`'s `scrim` prop lays a black wash under
  the white one, because a blur of a pale map has no contrast for light text. Map chrome
  passes `MAP_SCRIM`; nothing over the Aurora needs it.
- **Type is three loaded families, addressed per weight.** Bricolage Grotesque for display
  (titles, names, artists), Geist for UI, Geist Mono for join codes, set times, and ids.
  They load in `App.tsx` via `useNightglassFonts`, which gates first render — every
  `fontFamily` token is inert until it resolves. Always set `fontFamily` and **never**
  `fontWeight` alongside it: the combination makes Android synthesize the wrong face.
- Palette: `#07070B` substrate, `#6E6BFF`→`#A855F7` accent ramp, `#FF4D8D` for live/now
  states, `#5EEAD4` for landmarks (unchanged, so the map and the groups list still agree),
  `#FF7A7A` errors. Icons are `@expo/vector-icons`' Ionicons.
