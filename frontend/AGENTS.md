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
npm start        # Expo dev server; scan the QR with Expo Go
npm run ios      # simulator
npm run web      # browser (no real map — see the platform-split bullet)
npx tsc --noEmit # the only automated check in this package
```

There is no test suite, linter, or build step. `npx tsc --noEmit` is the gate — run it
before calling a change done. `.env` holds `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and the
optional `EXPO_PUBLIC_API_URL`; Expo only reads it at `npm start`, so a key change needs a
restart.

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
  once in `App.tsx` and its result is passed to both `MapScreen` and `GroupsScreen`.
  Location only streams to the backend while the status is `"live"` — nobody gets tracked
  between festivals. Groups with no `event_id`, or events with no schedule, count as live
  so pre-admin-tool rows keep working.
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
  must therefore be gated on props, not on mount.
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
- **Poll intervals are deliberate and live next to their hook**: location PUT 1.5s and
  group locations GET 2s (the backend's hot paths), group members 5s, event refetch 60s,
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
  name-screen fallback), but new cold resources should use `useCachedResource`.
- **Avatars come back in two forms** — absolute URLs from S3, host-relative paths from
  local-disk dev storage. Always render them through `avatarUri` / `avatarSource`, which
  normalize both.
- **Styling is per-file `StyleSheet.create` with no design system.** The one exception is
  `src/groups/styles.ts`, shared by every file in that folder — those screens are steps in
  one flow and share their card/title/button look, so a per-file split there would just
  duplicate the same primitives six times. Match the existing dark palette: `#101014`
  background, `#1c1c22` surfaces, `#2a2a32` borders, `#5b5bf0` accent (`#8b8bf5` for text on
  dark), `#9a9aa5` / `#71717c` secondary text, `#ff6b6b` errors. Icons are
  `@expo/vector-icons`' Ionicons.
