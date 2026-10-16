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
}
trap cleanup EXIT

chk() { # $1=name $2=expected-substring $3=actual
  if echo "$3" | grep -q "$2"; then PASS=$((PASS+1)); echo "ok   $1";
  else FAIL=$((FAIL+1)); echo "FAIL $1 => $3"; fi
}

PORT=$PORT nohup node index.js > /tmp/5thsave-smoke.log 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 30); do curl -s -m 2 "$BASE/products" > /dev/null 2>&1 && break; sleep 1; done
curl -s -m 2 "$BASE/products" > /dev/null 2>&1 || { echo "server did not start (see /tmp/5thsave-smoke.log)"; exit 1; }

E="$TAG@test.com"
chk "register" '"id"' "$(curl -s -X POST $BASE/auth/register -H 'Content-Type: application/json' -d "{\"username\":\"$TAG\",\"email\":\"$E\",\"password\":\"secret123\"}")"
T=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$E\",\"password\":\"secret123\"}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
chk "login-token" '.' "$T"
A="Authorization: Bearer $T"
chk "auth/me" "$E" "$(curl -s $BASE/auth/me -H "$A")"
chk "bad-login-401" 'Invalid credentials' "$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"nope@x.com","password":"secret123"}')"
chk "noauth-401" 'Not signed in' "$(curl -s $BASE/goals)"

G=$(curl -s -X POST $BASE/goals -H "$A" -H 'Content-Type: application/json' -d '{"amount_limit":1000,"start_date":"2026-10-01","end_date":"2026-10-08"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
chk "create-goal" '.' "$G"
chk "bad-goal-400" 'amount_limit' "$(curl -s -X POST $BASE/goals -H "$A" -H 'Content-Type: application/json' -d '{"amount_limit":-5,"start_date":"2026-10-01","end_date":"2026-10-08"}')"
chk "list-goals" '"total_spent":0' "$(curl -s $BASE/goals -H "$A")"
chk "products" '"id"' "$(curl -s $BASE/products)"
chk "categories" 'Food' "$(curl -s $BASE/products/categories)"
PID=$(curl -s $BASE/products | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
chk "add-cart" '"quantity":1' "$(curl -s -X POST $BASE/cart -H "$A" -H 'Content-Type: application/json' -d "{\"productId\":$PID,\"quantity\":1}")"
chk "bad-cart-404" 'Product not found' "$(curl -s -X POST $BASE/cart -H "$A" -H 'Content-Type: application/json' -d '{"productId":99999,"quantity":1}')"
chk "get-cart" '"quantity"' "$(curl -s $BASE/cart -H "$A")"
chk "shop-buy" 'Bought' "$(curl -s -X POST $BASE/shop/buy -H "$A" -H 'Content-Type: application/json' -d "{\"productId\":$PID,\"goalId\":$G}")"
chk "crossgoal-403" 'not yours' "$(curl -s -X POST $BASE/shop/buy -H "$A" -H 'Content-Type: application/json' -d "{\"productId\":$PID,\"goalId\":99999}")"
chk "checkout" 'Checkout successful' "$(curl -s -X POST $BASE/shop/checkout -H "$A" -H 'Content-Type: application/json' -d "{\"goalId\":$G}")"
chk "checkout-empty-400" 'Cart is empty' "$(curl -s -X POST $BASE/shop/checkout -H "$A" -H 'Content-Type: application/json' -d "{\"goalId\":$G}")"
chk "orders" 'product_name' "$(curl -s $BASE/orders -H "$A")"
chk "txn-spend" '"transaction_type":"spend"' "$(curl -s -X POST $BASE/transactions -H "$A" -H 'Content-Type: application/json' -d "{\"goal_id\":$G,\"amount\":-50,\"transaction_type\":\"spend\"}")"
chk "txn-badsign-400" 'must be negative' "$(curl -s -X POST $BASE/transactions -H "$A" -H 'Content-Type: application/json' -d "{\"goal_id\":$G,\"amount\":50,\"transaction_type\":\"spend\"}")"
# Net-spend check on its own goal: spend 800, refund 500 -> saver must be 70, not 20.
G3=$(curl -s -X POST $BASE/goals -H "$A" -H 'Content-Type: application/json' -d '{"amount_limit":1000,"start_date":"2026-10-01","end_date":"2026-10-08"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -s -X POST $BASE/transactions -H "$A" -H 'Content-Type: application/json' -d "{\"goal_id\":$G3,\"amount\":-800,\"transaction_type\":\"spend\"}" > /dev/null
curl -s -X POST $BASE/transactions -H "$A" -H 'Content-Type: application/json' -d "{\"goal_id\":$G3,\"amount\":500,\"transaction_type\":\"refund\"}" > /dev/null
chk "net-spend-saver-70" '"saver_score":70' "$(curl -s -X POST $BASE/goals/$G3/end -H "$A" -d '{}')"
curl -s -X DELETE $BASE/goals/$G3 -H "$A" > /dev/null
chk "skip-day" 'skipped successfully' "$(curl -s -X POST $BASE/goals/$G/skip-time -H "$A" -H 'Content-Type: application/json' -d '{"interval":"day"}')"
chk "skip-bad-400" 'Invalid interval' "$(curl -s -X POST $BASE/goals/$G/skip-time -H "$A" -H 'Content-Type: application/json' -d '{"interval":"year"}')"

C=$(curl -s -X POST $BASE/circles -H "$A" -H 'Content-Type: application/json' -d '{"circle_name":"Smoke Circle"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
chk "create-circle" '.' "$C"
chk "list-circles" 'Smoke Circle' "$(curl -s $BASE/circles -H "$A")"
INV=$(curl -s -X POST $BASE/circles/invite -H "$A" -H 'Content-Type: application/json' -d "{\"circle_id\":$C}" | python3 -c "import sys,json; print(json.load(sys.stdin)['invite_token'])")
chk "invite" '.' "$INV"
chk "invite-preview" 'Smoke Circle' "$(curl -s $BASE/circles/invite/$INV)"
E2="${TAG}b@test.com"
curl -s -X POST $BASE/auth/register -H 'Content-Type: application/json' -d "{\"username\":\"${TAG}b\",\"email\":\"$E2\",\"password\":\"secret123\"}" > /dev/null
T2=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$E2\",\"password\":\"secret123\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
chk "join-invite" 'Joined circle' "$(curl -s -X POST $BASE/circles/join-invite -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d "{\"token\":\"$INV\"}")"
chk "leaderboard" 'username' "$(curl -s $BASE/leaderboard/$C -H "$A")"
chk "leaderboard-guard-403" 'must be a member' "$(curl -s $BASE/leaderboard/99999 -H "$A")"
chk "leave" 'Left circle' "$(curl -s -X DELETE $BASE/circles/$C/leave -H "Authorization: Bearer $T2")"
chk "end-goal" 'saver_score' "$(curl -s -X POST $BASE/goals/$G/end -H "$A" -d '{}')"
chk "rewards" 'checkpoint_percentage' "$(curl -s $BASE/rewards -H "$A")"
chk "clear-rewards" 'Cleared' "$(curl -s -X DELETE $BASE/goals/$G/rewards -H "$A")"
chk "del-goal" 'deleted' "$(curl -s -X DELETE $BASE/goals/$G -H "$A")"
chk "del-circle" 'deleted' "$(curl -s -X DELETE $BASE/circles/$C -H "$A")"

echo "--- PASS=$PASS FAIL=$FAIL ---"
[ "$FAIL" -eq 0 ]
