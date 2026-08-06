# Grupee — dev shortcuts.
#
# One discoverable entrypoint tying the three packages together. Run `make` (or
# `make help`) to list targets. Recipes call the backend venv binaries directly
# (backend/.venv/bin/*) so no `source` is needed.
#
# Naming: `make <package>` runs it against your LOCAL backend, `make <package>-staging`
# against the deployed staging backend. Targets are named for the directories
# (backend/frontend/admin) so there's one vocabulary to remember.
#
# THERE IS DELIBERATELY NO -prod TARGET. The app can't reach production from a dev
# machine at all (there is no `start:prod` script — production is TestFlight only),
# and the admin console reaches it solely through an explicit
# `cd admin && npm run dev:prod`, which is a real operation rather than testing.
# Don't add prod targets here: `make` should never be one typo away from live data.
#
# Assumes the documented local setup: Homebrew Postgres + Redis running, a
# backend/.venv with deps installed, and backend/.env holding CLERK_PUBLISHABLE_KEY
# + a local DATABASE_URL. See README.md for first-time setup.

DB_NAME ?= wheretheyat_dev
UVICORN  = .venv/bin/uvicorn
ALEMBIC  = .venv/bin/alembic
PSQL     = psql -d $(DB_NAME)

.DEFAULT_GOAL := help

.PHONY: help backend backend-dev frontend frontend-staging admin admin-staging \
        migrate reset reset-user grant-admin users smoke verify

help: ## List the available commands
	@echo "Grupee — make <target>"
	@echo
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-17s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "  reset-user / grant-admin need CLERK_ID=user_xxx (see 'make users')."
	@echo "  No prod targets by design — production is TestFlight only, except"
	@echo "  the admin console: cd admin && npm run dev:prod"

## --- run against your local backend ---------------------------------------

backend: ## Backend on :8000 (real Clerk auth), reachable over Wi-Fi
	cd backend && $(UVICORN) app.main:app --reload --host 0.0.0.0

frontend: ## Metro for the dev client → local backend (LAN auto-detect)
	cd frontend && npm start

admin: ## Admin console on :5173 → local backend
	cd admin && npm run dev

## --- run against the deployed staging backend -----------------------------

frontend-staging: ## Metro for the dev client → staging
	cd frontend && npm run start:staging

admin-staging: ## Admin console → staging
	cd admin && npm run dev:staging

backend-dev: ## Backend with AUTH_DEV_MODE=1 (only for `make smoke`)
	cd backend && AUTH_DEV_MODE=1 $(UVICORN) app.main:app --reload

## --- database & first-login ----------------------------------------------

migrate: ## Apply Alembic migrations to the local database
	cd backend && $(ALEMBIC) upgrade head

reset: ## Wipe the DB (+ live positions) and re-migrate — true first-time login
	dropdb --force --if-exists $(DB_NAME)
	createdb $(DB_NAME)
	cd backend && $(ALEMBIC) upgrade head
	-redis-cli flushdb
	@echo "Reset done. Log in on a client to re-provision, then: make grant-admin CLERK_ID=..."

reset-user: ## Delete one user by CLERK_ID (keeps events) so next login re-provisions
	@test -n "$(CLERK_ID)" || { echo "usage: make reset-user CLERK_ID=user_xxx"; exit 1; }
	$(PSQL) -c "UPDATE events SET creator_id = NULL WHERE creator_id = (SELECT id FROM users WHERE clerk_id = '$(CLERK_ID)');"
	$(PSQL) -c "UPDATE groups SET creator_id = NULL WHERE creator_id = (SELECT id FROM users WHERE clerk_id = '$(CLERK_ID)');"
	$(PSQL) -c "DELETE FROM users WHERE clerk_id = '$(CLERK_ID)';"

grant-admin: ## Grant admin to a user by CLERK_ID (the only way past the admin gate)
	@test -n "$(CLERK_ID)" || { echo "usage: make grant-admin CLERK_ID=user_xxx"; exit 1; }
	$(PSQL) -c "UPDATE users SET is_admin = true WHERE clerk_id = '$(CLERK_ID)';"

users: ## List users (find your clerk_id here)
	$(PSQL) -c "SELECT id, clerk_id, display_name, is_admin FROM users ORDER BY created_at;"

## --- checks ---------------------------------------------------------------

smoke: ## Run the backend e2e smoke test (needs `make backend-dev` running elsewhere)
	cd backend && ./smoke_test.sh

verify: ## Static preflight before pushing to staging (both client typechecks)
	cd admin && npx tsc -b
	cd frontend && npx tsc --noEmit
