# Grupee setup and deployment

This is the operational guide for local development, staging, and production. Read it before
starting services, changing environment variables, running migrations, or deploying.

## Local development

### Requirements

- Python 3.12
- Node 20+
- Docker Desktop
- Xcode, an Expo account, and an Apple Developer account only when testing on iOS
- A Clerk development publishable key (`pk_test_...`)

If Homebrew Postgres or Redis is running, stop it before using Docker's ports:

```bash
brew services stop postgresql@14
brew services stop redis
```

### Set up once

1. Start Docker Desktop.
2. From the repository root, run:

   ```bash
   make setup
   ```

3. Put the same Clerk development key in these gitignored files:

   ```dotenv
   CLERK_PUBLISHABLE_KEY=pk_test_...             # backend/.env
   EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_... # frontend/.env.dev
   VITE_CLERK_PUBLISHABLE_KEY=pk_test_...        # admin/.env
   ```

`make setup` creates missing environment files from their examples, installs dependencies,
starts Docker Postgres and Redis, and applies Alembic migrations. It never overwrites an
existing environment file.

The local database URL is
`postgresql://wheretheyat:localdev@localhost:5432/wheretheyat_dev`. Local Make targets set it
themselves. Leave `REDIS_URL` unset for `redis://localhost:6379/0`, and leave
`EXPO_PUBLIC_API_URL` and `VITE_API_URL` unset so the clients choose the local backend.

Set `VITE_MAPBOX_ACCESS_TOKEN=pk_...` in `admin/.env` to render the event editor map. It may use
the same public Mapbox token as the Expo app, where it is named
`EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` in `frontend/.env.dev`.

### Run locally

Use three terminals at the repository root:

```bash
make backend     # starts Postgres + Redis, then FastAPI on :8000
make frontend    # Metro for the Expo development build
make admin       # Vite admin console on :5173
```

Useful commands:

```bash
make services-status
make services-down       # stop containers; preserve Postgres data
make migrate             # apply new migrations
make reset               # erase local Postgres and Redis data, then migrate
make users
make grant-admin CLERK_ID=user_xxx
make verify
```

For the backend end-to-end test, run `make backend-dev` in one terminal and `make smoke` in
another. `AUTH_DEV_MODE` is for local smoke tests only; never use it on a deployed service.

### iOS development build

The app does not run in Expo Go because it needs native background-location support. Build the
development client once, then reuse it for JavaScript and TypeScript changes.

```bash
cd frontend
npx eas-cli login
npx eas-cli device:create                    # if the physical iPhone is not registered
npx eas-cli build --platform ios --profile development
```

Install the resulting build using the EAS install link on the registered iPhone. Enable iOS
Developer Mode. Keep the phone and Mac on the same Wi-Fi while Metro and the backend are
running. Rebuild only after changing `app.json`, a config plugin, native permissions, or a
native dependency.

Set `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=pk_...` in `frontend/.env.dev` to render the native map.
Create a Clerk JWT template named `background` with a 43,200-second lifetime and
`{"scope": "bg-location"}` to test background reporting.

## Staging

Staging is a separate Railway environment with its own disposable Postgres and Redis data.
Use it for device builds and test data, never production.

### Create or repair the environment

1. In Railway, duplicate the production environment and name it `staging`.
2. Confirm the API service root directory is `backend`.
3. Ensure the API service has these variables:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `REDIS_URL` | `${{Redis.REDIS_URL}}` |
   | `CLERK_PUBLISHABLE_KEY` | Clerk development key |
   | `LOG_LEVEL` | `INFO` |

4. Deploy the service. Railway runs `alembic upgrade head` through `backend/railway.json` before
   starting the API.

Run clients against staging from the repository root:

```bash
make frontend-staging
make admin-staging
```

Populate `frontend/.env.staging` from `frontend/.env.staging.example` before starting the
mobile client. The file is gitignored and must contain the staging Clerk publishable key and
staging API URL.

The staging database begins empty. Create or provision an admin user, then create an event,
boundary, landmarks, and current set before testing the mobile app.

To run the backend smoke test against staging, use the staging public Postgres and Redis URLs
in a local backend process. The smoke test writes disposable records to staging:

```bash
cd backend
AUTH_DEV_MODE=1 DATABASE_URL='<staging Postgres DATABASE_PUBLIC_URL>' \
REDIS_URL='<staging Redis REDIS_PUBLIC_URL>' .venv/bin/uvicorn app.main:app --port 8001
./smoke_test.sh http://127.0.0.1:8001
```

## Production

Production contains real data. Do not point a local mobile development session or `make smoke`
at it.

### Backend deployment

Configure the Railway production API service with root directory `backend`; its checked-in
`railway.json` applies migrations once before deployment, starts two Uvicorn workers, and checks
`/health`. Use private Railway references for `DATABASE_URL` and `REDIS_URL`, set
`CLERK_PUBLISHABLE_KEY` to the production Clerk key, and never set `AUTH_DEV_MODE`.

Set R2/S3 storage variables before accepting real avatar uploads: `S3_BUCKET`,
`S3_ENDPOINT_URL`, `S3_PUBLIC_URL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and
`AWS_SECRET_ACCESS_KEY`. Railway container disk is ephemeral.

Deploy through the production service's configured Railway source branch. Verify the deployed
`/health` endpoint after the deploy.

### Admin console and mobile releases

The only local command that targets the production API is for intentional festival management:

```bash
cd admin
npm run dev:prod
```

`frontend/.env.prod` is a gitignored local reference file. Populate it from
`frontend/.env.prod.example` when needed, but it is not used by local Metro commands or EAS
cloud builds. The production EAS profile in `frontend/eas.json` remains the build-time source.

The `production` EAS profile targets the production API. Build and submit it only when the app
is ready for App Store Connect:

```bash
cd frontend
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production --latest
```

The `recruiter` profile targets staging for TestFlight-style testing. Before a public release,
complete the App Store requirements for account deletion, privacy disclosures, production Clerk,
and App Store compliance.
