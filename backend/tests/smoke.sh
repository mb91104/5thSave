#!/usr/bin/env bash
# 5thSave backend smoke test.
# Self-contained: boots its own server on a test port, exercises every route,
# then kills the server and removes the users it created.
# Requires: PostgreSQL running + backend/.env (DATABASE_URL, JWT_SECRET).
set -u
cd "$(dirname "$0")/.." || exit 1

set -a
# shellcheck disable=SC1091
source .env || { echo "missing backend/.env"; exit 1; }
set +a

PORT=3457
BASE="http://localhost:$PORT"
TAG="smoke$RANDOM"
PASS=0
FAIL=0

cleanup() {
  kill "$SERVER_PID" 2>/dev/null
  psql "$DATABASE_URL" -tc "DELETE FROM users WHERE email LIKE '$TAG%';" > /dev/null 2>&1
  rm -f "$JAR" "$JAR2" "$REG_HEADERS" "$LOGIN_HEADERS"
}
trap cleanup EXIT

JAR=$(mktemp)
JAR2=$(mktemp)
REG_HEADERS=$(mktemp)
LOGIN_HEADERS=$(mktemp)

chk() { # $1=name $2=expected-substring $3=actual
  if echo "$3" | grep -q "$2"; then PASS=$((PASS+1)); echo "ok   $1";
  else FAIL=$((FAIL+1)); echo "FAIL $1 => $3"; fi
}

PORT=$PORT nohup node index.js > /tmp/5thsave-smoke.log 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 30); do curl -s -m 2 "$BASE/products" > /dev/null 2>&1 && break; sleep 1; done
curl -s -m 2 "$BASE/products" > /dev/null 2>&1 || { echo "server did not start (see /tmp/5thsave-smoke.log)"; exit 1; }

E="$TAG@test.com"
REG_BODY=$(curl -s -D "$REG_HEADERS" -c "$JAR" -X POST $BASE/auth/register -H 'Content-Type: application/json' -d "{\"username\":\"$TAG\",\"email\":\"$E\",\"password\":\"secret123\"}")
chk "register" '"username"' "$REG_BODY"
chk "register-sets-cookie" 'fifthsave_session' "$(grep -i '^set-cookie' "$REG_HEADERS")"
chk "register-cookie-httponly" 'HttpOnly' "$(grep -i '^set-cookie' "$REG_HEADERS")"
chk "register-no-token-in-body" 'no-body-token' "$(echo "$REG_BODY" | grep -q '"token"' && echo body-token || echo no-body-token)"
chk "login" '"username"' "$(curl -s -D "$LOGIN_HEADERS" -c "$JAR" -X POST $BASE/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$E\",\"password\":\"secret123\"}")"
chk "login-sets-cookie" 'fifthsave_session' "$(grep -i '^set-cookie' "$LOGIN_HEADERS")"
chk "auth/me" "$E" "$(curl -s $BASE/auth/me -b "$JAR")"
chk "bad-login-401" 'Invalid credentials' "$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"nope@x.com","password":"secret123"}')"
chk "noauth-401" 'Not signed in' "$(curl -s $BASE/goals)"

G=$(curl -s -X POST $BASE/goals -b "$JAR" -H 'Content-Type: application/json' -d '{"amount_limit":1000,"start_date":"2026-10-01","end_date":"2026-10-08"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
chk "create-goal" '.' "$G"
chk "bad-goal-400" 'amount_limit' "$(curl -s -X POST $BASE/goals -b "$JAR" -H 'Content-Type: application/json' -d '{"amount_limit":-5,"start_date":"2026-10-01","end_date":"2026-10-08"}')"
chk "list-goals" '"total_spent":0' "$(curl -s $BASE/goals -b "$JAR")"
chk "products" '"id"' "$(curl -s $BASE/products)"
chk "categories" 'Food' "$(curl -s $BASE/products/categories)"
PID=$(curl -s $BASE/products | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
chk "add-cart" '"quantity":1' "$(curl -s -X POST $BASE/cart -b "$JAR" -H 'Content-Type: application/json' -d "{\"productId\":$PID,\"quantity\":1}")"
chk "bad-cart-404" 'Product not found' "$(curl -s -X POST $BASE/cart -b "$JAR" -H 'Content-Type: application/json' -d '{"productId":99999,"quantity":1}')"
chk "get-cart" '"quantity"' "$(curl -s $BASE/cart -b "$JAR")"
chk "shop-buy" 'Bought' "$(curl -s -X POST $BASE/shop/buy -b "$JAR" -H 'Content-Type: application/json' -d "{\"productId\":$PID,\"goalId\":$G}")"
chk "crossgoal-403" 'not yours' "$(curl -s -X POST $BASE/shop/buy -b "$JAR" -H 'Content-Type: application/json' -d "{\"productId\":$PID,\"goalId\":99999}")"
chk "checkout" 'Checkout successful' "$(curl -s -X POST $BASE/shop/checkout -b "$JAR" -H 'Content-Type: application/json' -d "{\"goalId\":$G}")"
chk "checkout-empty-400" 'Cart is empty' "$(curl -s -X POST $BASE/shop/checkout -b "$JAR" -H 'Content-Type: application/json' -d "{\"goalId\":$G}")"
chk "orders" 'product_name' "$(curl -s $BASE/orders -b "$JAR")"
chk "txn-spend" '"transaction_type":"spend"' "$(curl -s -X POST $BASE/transactions -b "$JAR" -H 'Content-Type: application/json' -d "{\"goal_id\":$G,\"amount\":-50,\"transaction_type\":\"spend\"}")"
chk "txn-badsign-400" 'must be negative' "$(curl -s -X POST $BASE/transactions -b "$JAR" -H 'Content-Type: application/json' -d "{\"goal_id\":$G,\"amount\":50,\"transaction_type\":\"spend\"}")"
# Net-spend check on its own goal: spend 800, refund 500 -> saver must be 70, not 20.
G3=$(curl -s -X POST $BASE/goals -b "$JAR" -H 'Content-Type: application/json' -d '{"amount_limit":1000,"start_date":"2026-10-01","end_date":"2026-10-08"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -s -X POST $BASE/transactions -b "$JAR" -H 'Content-Type: application/json' -d "{\"goal_id\":$G3,\"amount\":-800,\"transaction_type\":\"spend\"}" > /dev/null
curl -s -X POST $BASE/transactions -b "$JAR" -H 'Content-Type: application/json' -d "{\"goal_id\":$G3,\"amount\":500,\"transaction_type\":\"refund\"}" > /dev/null
chk "net-spend-saver-70" '"saver_score":70' "$(curl -s -X POST $BASE/goals/$G3/end -b "$JAR" -d '{}')"
curl -s -X DELETE $BASE/goals/$G3 -b "$JAR" > /dev/null
chk "skip-day" 'skipped successfully' "$(curl -s -X POST $BASE/goals/$G/skip-time -b "$JAR" -H 'Content-Type: application/json' -d '{"interval":"day"}')"
chk "skip-bad-400" 'Invalid interval' "$(curl -s -X POST $BASE/goals/$G/skip-time -b "$JAR" -H 'Content-Type: application/json' -d '{"interval":"year"}')"

C=$(curl -s -X POST $BASE/circles -b "$JAR" -H 'Content-Type: application/json' -d '{"circle_name":"Smoke Circle"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
chk "create-circle" '.' "$C"
chk "list-circles" 'Smoke Circle' "$(curl -s $BASE/circles -b "$JAR")"
INV=$(curl -s -X POST $BASE/circles/invite -b "$JAR" -H 'Content-Type: application/json' -d "{\"circle_id\":$C}" | python3 -c "import sys,json; print(json.load(sys.stdin)['invite_token'])")
chk "invite" '.' "$INV"
chk "invite-preview" 'Smoke Circle' "$(curl -s $BASE/circles/invite/$INV)"
E2="${TAG}b@test.com"
curl -s -c "$JAR2" -X POST $BASE/auth/register -H 'Content-Type: application/json' -d "{\"username\":\"${TAG}b\",\"email\":\"$E2\",\"password\":\"secret123\"}" > /dev/null
chk "join-invite" 'Joined circle' "$(curl -s -X POST $BASE/circles/join-invite -b "$JAR2" -H 'Content-Type: application/json' -d "{\"token\":\"$INV\"}")"
chk "leaderboard" 'username' "$(curl -s $BASE/leaderboard/$C -b "$JAR")"
chk "leaderboard-guard-403" 'must be a member' "$(curl -s $BASE/leaderboard/99999 -b "$JAR")"
chk "leave" 'Left circle' "$(curl -s -X DELETE $BASE/circles/$C/leave -b "$JAR2")"
chk "end-goal" 'saver_score' "$(curl -s -X POST $BASE/goals/$G/end -b "$JAR" -d '{}')"
chk "re-end-400" 'already finished' "$(curl -s -X POST $BASE/goals/$G/end -b "$JAR" -d '{}')"
chk "buy-completed-400" 'already completed' "$(curl -s -X POST $BASE/shop/buy -b "$JAR" -H 'Content-Type: application/json' -d "{\"productId\":$PID,\"goalId\":$G}")"
chk "txn-spend-completed-400" 'only refunds' "$(curl -s -X POST $BASE/transactions -b "$JAR" -H 'Content-Type: application/json' -d "{\"goal_id\":$G,\"amount\":-10,\"transaction_type\":\"spend\"}")"
chk "txn-refund-completed-ok" '"transaction_type":"refund"' "$(curl -s -X POST $BASE/transactions -b "$JAR" -H 'Content-Type: application/json' -d "{\"goal_id\":$G,\"amount\":10,\"transaction_type\":\"refund\"}")"
chk "rewards" 'checkpoint_percentage' "$(curl -s $BASE/rewards -b "$JAR")"
chk "clear-rewards" 'Cleared' "$(curl -s -X DELETE $BASE/goals/$G/rewards -b "$JAR")"
chk "del-goal" 'deleted' "$(curl -s -X DELETE $BASE/goals/$G -b "$JAR")"
chk "del-circle" 'deleted' "$(curl -s -X DELETE $BASE/circles/$C -b "$JAR")"
chk "logout" 'Signed out' "$(curl -s -b "$JAR" -c "$JAR" -X POST $BASE/auth/logout)"
chk "after-logout-401" 'Not signed in' "$(curl -s $BASE/auth/me -b "$JAR")"

echo "--- PASS=$PASS FAIL=$FAIL ---"
[ "$FAIL" -eq 0 ]
