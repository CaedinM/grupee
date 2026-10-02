# Grupee

Grupee is a festival companion app for coordinating with friends during an event.

## What it does

- Create a group for a festival and share a four-letter join code.
- Show group members on a live map while the festival is active.
- Display festival boundaries, landmarks, and stage schedules.
- Identify the stage a member is currently near and surface the current or next act.
- Track attended sets from time spent inside a live stage geofence.
- Preserve finished groups as event history while stopping their live-location stream.
- Let festival operators create events, draw geofences, manage landmarks, and schedule sets.

Live location is intentionally latest-only. Grupee keeps one expiring location per user in Redis
and does not retain a location trail in Postgres.

## Design choices

- **Privacy by default:** live positions expire automatically; durable data contains only the
  product records needed for groups, festivals, and attendance conclusions.
- **Real-time coordination:** foreground clients use WebSockets with Redis pub/sub so location
  updates reach group members across backend workers. Background iOS location reports use an
  authenticated HTTP fallback.
- **Festival-scoped activity:** group creation and joining respect an event's lifetime; completed
  festivals remain readable as history.
- **Native map experience:** the iOS development build uses Mapbox for venue geometry, landmarks,
  member markers, and live-stage context.
- **Operator-authored venue data:** a separate admin console owns events, boundaries, landmarks,
  and set schedules.

## Technology

- **Mobile:** Expo, React Native, TypeScript, Mapbox
- **Backend:** FastAPI, SQLAlchemy, Alembic, PostgreSQL, Redis
- **Admin console:** Vite, React, TypeScript, Leaflet
- **Authentication:** Clerk
- **Storage and hosting:** Cloudflare R2 and Railway
- **Local services:** Docker
