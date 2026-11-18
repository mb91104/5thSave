#!/usr/bin/env bash
# Live deployment smoke test: exercises auth + one protected route against a
# real deployed URL. Run after every deploy so a broken function is caught
# immediately (a crashed function returns Vercel's opaque 500 instead of JSON).
#
# Usage:
#   tests/live-smoke.sh                     # https://5thsave.vercel.app
#   tests/live-smoke.sh https://my-app.vercel.app
#
# Creates one throwaway user (live$RANDOM@example.com) because the API has no
# account-deletion endpoint. Goals created by the test are deleted.
set -u

BASE="${1:-https://5thsave.vercel.app}"
TAG="live$RANDOM$RANDOM"
JAR=$(mktemp)
HEADERS=$(mktemp)
cleanup() { rm -f "$JAR" "$HEADERS"; }
trap cleanup EXIT

PASS=0
FAIL=0
chk() { # $1=name $2=expected-substring $3=actual
  if echo "$3" | grep -q "$2"; then PASS=$((PASS+1)); echo "ok   $1";
  else FAIL=$((FAIL+1)); echo "FAIL $1 => $3"; fi
}

echo "Smoke testing $BASE"

HEALTH=$(curl -s -m 20 "$BASE/api/health")
chk "health" '"status":"ok"' "$HEALTH"
chk "health-jwt" '"jwtSecret":true' "$HEALTH"
chk "health-db" '"database":"up"' "$HEALTH"
chk "products" '"id"' "$(curl -s -m 20 "$BASE/api/products")"
chk "noauth-401" 'Not signed in' "$(curl -s -m 20 "$BASE/api/goals")"

E="$TAG@example.com"
chk "register" '"username"' "$(curl -s -m 20 -D "$HEADERS" -c "$JAR" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' -d "{\"username\":\"$TAG\",\"email\":\"$E\",\"password\":\"secret123\"}")"
chk "register-cookie" 'fifthsave_session' "$(grep -i '^set-cookie' "$HEADERS")"
chk "login" '"username"' "$(curl -s -m 20 -c "$JAR" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$E\",\"password\":\"secret123\"}")"
chk "auth/me" "$E" "$(curl -s -m 20 -b "$JAR" "$BASE/api/auth/me")"

G=$(curl -s -m 20 -b "$JAR" -X POST "$BASE/api/goals" -H 'Content-Type: application/json' \
  -d '{"amount_limit":1000,"start_date":"2026-10-01","end_date":"2026-10-08"}' \
  | python3 -c "import sys,json
raw = sys.stdin.read()
try:
    print(json.loads(raw).get('id',''))
except Exception:
    print('')")
chk "create-goal" '.' "$G"
if [ -n "$G" ]; then
  chk "delete-goal" 'deleted' "$(curl -s -m 20 -X DELETE -b "$JAR" "$BASE/api/goals/$G")"
fi

chk "logout" 'Signed out' "$(curl -s -m 20 -b "$JAR" -c "$JAR" -X POST "$BASE/api/auth/logout")"
chk "after-logout-401" 'Not signed in' "$(curl -s -m 20 -b "$JAR" "$BASE/api/auth/me")"

echo "--- PASS=$PASS FAIL=$FAIL ---"
[ "$FAIL" -eq 0 ]
