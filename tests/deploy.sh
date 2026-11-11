#!/usr/bin/env bash
# Deployment smoke test: builds the frontend, serves frontend/dist with the
# same SPA fallback Vercel uses, routes /api/* through the Vercel Serverless
# Function entry points, and exercises the API over that path.
#
# Requires: PostgreSQL running + backend/.env (DATABASE_URL, JWT_SECRET).
# Usage: npm run test:deploy
set -u
cd "$(dirname "$0")/.." || exit 1

TAG="deploy$RANDOM"
PASS=0
FAIL=0
SERVER_PID=""

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  if [ -n "${DATABASE_URL:-}" ] && command -v psql >/dev/null 2>&1; then
    psql "$DATABASE_URL" -tc "DELETE FROM users WHERE email LIKE '$TAG%';" >/dev/null 2>&1
  fi
}
trap cleanup EXIT

chk() { # $1=name $2=expected-substring $3=actual
  if echo "$3" | grep -q "$2"; then PASS=$((PASS+1)); echo "ok   $1";
  else FAIL=$((FAIL+1)); echo "FAIL $1 => $3"; fi
}

echo "Building frontend ..."
npm run build >/dev/null || { echo "frontend build failed"; exit 1; }

set -a
# shellcheck disable=SC1091
[ -f backend/.env ] && . backend/.env
set +a

# Set after sourcing backend/.env so its PORT cannot override the test port.
PORT="${DEPLOY_TEST_PORT:-4567}"
BASE="http://127.0.0.1:$PORT"

PORT="$PORT" node tests/vercel-sim.js > /tmp/5thsave-deploy.log 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 30); do curl -s -m 2 "$BASE/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -s -m 2 "$BASE/api/health" >/dev/null 2>&1 || {
  echo "server did not start (see /tmp/5thsave-deploy.log)";
  cat /tmp/5thsave-deploy.log;
  exit 1;
}

chk "health" '"status":"ok"' "$(curl -s "$BASE/api/health")"
chk "health-db" '"database":"up"' "$(curl -s "$BASE/api/health")"
chk "spa-root" '<div id="root">' "$(curl -s "$BASE/")"
chk "spa-invite-route" '<div id="root">' "$(curl -s "$BASE/join/abc123")"
ASSET=$(ls frontend/dist/assets | grep '\.js$' | head -1)
chk "static-js" 'javascript' "$(curl -s -I "$BASE/assets/$ASSET" | tr -d '\r')"
chk "products" '"id"' "$(curl -s "$BASE/api/products")"
chk "categories" 'Food' "$(curl -s "$BASE/api/products/categories")"
chk "noauth-401" 'Not signed in' "$(curl -s "$BASE/api/goals")"
chk "notfound-json" 'Not found' "$(curl -s "$BASE/api/does-not-exist")"

E="$TAG@test.com"
chk "register" '"id"' "$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' -d "{\"username\":\"$TAG\",\"email\":\"$E\",\"password\":\"secret123\"}")"
T=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$E\",\"password\":\"secret123\"}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
chk "login-token" '.' "$T"
A="Authorization: Bearer $T"
chk "auth/me" "$E" "$(curl -s "$BASE/api/auth/me" -H "$A")"
G=$(curl -s -X POST "$BASE/api/goals" -H "$A" -H 'Content-Type: application/json' -d '{"amount_limit":1000,"start_date":"2026-10-01","end_date":"2026-10-08"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
chk "create-goal" '.' "$G"
PID=$(curl -s "$BASE/api/products" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
chk "cart" '"quantity"' "$(curl -s -X POST "$BASE/api/cart" -H "$A" -H 'Content-Type: application/json' -d "{\"productId\":$PID,\"quantity\":1}")"
chk "checkout" 'Checkout successful' "$(curl -s -X POST "$BASE/api/shop/checkout" -H "$A" -H 'Content-Type: application/json' -d "{\"goalId\":$G}")"
chk "delete-goal" 'deleted' "$(curl -s -X DELETE "$BASE/api/goals/$G" -H "$A")"

echo "--- PASS=$PASS FAIL=$FAIL ---"
[ "$FAIL" -eq 0 ]
