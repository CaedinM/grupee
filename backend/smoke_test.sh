#!/usr/bin/env bash
# Smoke test for the Grupee backend — exercises the full acceptance flow.
# Usage: ./smoke_test.sh [base_url]   (default http://127.0.0.1:8000)
# Requires: curl, python3 (for JSON parsing)
#
# The server must run with AUTH_DEV_MODE=1 (bearer token is taken verbatim as
# the Clerk user id, no verification):
#   AUTH_DEV_MODE=1 uvicorn app.main:app --reload
set -euo pipefail

BASE="${1:-http://127.0.0.1:8000}"

# Random per run so re-runs create fresh users instead of hitting the
# idempotent 200 path of POST /users.
TOKEN_A="dev_clerk_a_${RANDOM}${RANDOM}"
TOKEN_B="dev_clerk_b_${RANDOM}${RANDOM}"

json() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }
step() { echo; echo "== $1"; }
as_a() { curl -sf -H "Authorization: Bearer $TOKEN_A" "$@"; }
as_b() { curl -sf -H "Authorization: Bearer $TOKEN_B" "$@"; }

step "Health"
curl -sf "$BASE/health"

step "0. Requests without a token are rejected"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/events")
echo "unauthenticated GET /events -> $STATUS"
[ "$STATUS" = "401" ]

step "1. Create two users (identity from the bearer token)"
USER_A=$(as_a -X POST "$BASE/users" -H 'Content-Type: application/json' \
  -d '{"display_name":"Caedin"}' | json "['id']")
USER_B=$(as_b -X POST "$BASE/users" -H 'Content-Type: application/json' \
  -d '{"display_name":"Sam"}' | json "['id']")
echo "A=$USER_A  B=$USER_B"

step "1b. Re-registering the same account returns the same user"
AGAIN=$(as_a -X POST "$BASE/users" -H 'Content-Type: application/json' \
  -d '{"display_name":"Someone Else"}' | json "['id']")
[ "$AGAIN" = "$USER_A" ]
as_a "$BASE/users/me" | json "['display_name']"

step "2. User A creates a group (A becomes admin)"
GROUP=$(as_a -X POST "$BASE/groups" -H 'Content-Type: application/json' \
  -d '{"name":"The Crew"}')
GROUP_ID=$(echo "$GROUP" | json "['id']")
CODE=$(echo "$GROUP" | json "['code']")
echo "group=$GROUP_ID  code=$CODE"
as_a "$BASE/groups/$GROUP_ID" | json "['members']"

step "3. User B joins with the code"
as_b -X POST "$BASE/groups/$CODE/members"
echo

step "4. Both users PUT their locations"
as_a -X PUT "$BASE/users/$USER_A/location" -H 'Content-Type: application/json' \
  -d '{"lat":37.101,"lng":-122.201,"heading":84.0,"battery":72,"accuracy":5.0}'
echo
as_b -X PUT "$BASE/users/$USER_B/location" -H 'Content-Type: application/json' \
  -d '{"lat":37.102,"lng":-122.199,"battery":51}'
echo

step "4b. Writing someone else's location is rejected"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/users/$USER_A/location" \
  -H "Authorization: Bearer $TOKEN_B" -H 'Content-Type: application/json' \
  -d '{"lat":0,"lng":0}')
echo "B writing A's location -> $STATUS"
[ "$STATUS" = "403" ]

step "5. Group locations returns both members with positions"
as_a "$BASE/groups/$GROUP_ID/locations"
echo

step "6. Create an event, set boundary, add two landmarks"
EVENT_ID=$(as_a -X POST "$BASE/events" -H 'Content-Type: application/json' \
  -d '{"name":"Sundown Fest"}' | json "['id']")
echo "event=$EVENT_ID"
as_a -X PUT "$BASE/events/$EVENT_ID/boundary" -H 'Content-Type: application/json' \
  -d '{"points":[[37.10,-122.20],[37.11,-122.19],[37.09,-122.18]]}'
echo
as_a -X POST "$BASE/events/$EVENT_ID/landmarks" -H 'Content-Type: application/json' \
  -d '{"name":"Main Stage","kind":"stage","lat":37.105,"lng":-122.195}'
echo
as_a -X POST "$BASE/events/$EVENT_ID/landmarks" -H 'Content-Type: application/json' \
  -d '{"name":"Medical Tent","kind":"medical","lat":37.103,"lng":-122.197}'
echo

step "7. Event map returns boundary and both landmarks"
as_a "$BASE/events/$EVENT_ID/map"
echo

step "8. Event writes by a non-creator return 403"
# Body must pass validation (min 3 points) or the 422 fires before the admin check.
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/events/$EVENT_ID/boundary" \
  -H "Authorization: Bearer $TOKEN_B" -H 'Content-Type: application/json' \
  -d '{"points":[[0,0],[0,1],[1,0]]}')
echo "boundary as non-creator -> $STATUS"
[ "$STATUS" = "403" ]
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/events/$EVENT_ID/landmarks" \
  -H "Authorization: Bearer $TOKEN_B" -H 'Content-Type: application/json' \
  -d '{"name":"Nope","kind":"other","lat":0,"lng":0}')
echo "landmark as non-creator -> $STATUS"
[ "$STATUS" = "403" ]

echo
echo "✅ All smoke test steps passed."
