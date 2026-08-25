#!/usr/bin/env bash
# Smoke test for the RSVP "open sign-up / shared link" feature.
# Starts a throwaway dev server (own port + own DB), drives the full flow with curl,
# then cleans up. Does NOT touch the production service or its database.
set -u
cd "$(dirname "$0")"

PORT=3998
BASE="http://127.0.0.1:$PORT"
DB="/tmp/rsvp-smoke-$$.db"
JAR="/tmp/rsvp-smoke-org-$$.jar"
JAR2="/tmp/rsvp-smoke-pub-$$.jar"
rm -f "$DB" "$JAR" "$JAR2"

if [ ! -d node_modules ]; then
  echo "Installing dependencies (npm ci)…"
  npm ci >/tmp/rsvp-smoke-npm.log 2>&1 || { echo "npm ci failed — see /tmp/rsvp-smoke-npm.log"; exit 1; }
fi

echo "Starting throwaway dev server on $PORT …"
DEV_BYPASS_AUTH=true DEV_EMAIL=admin@example.com ADMIN_EMAIL=admin@example.com \
  CF_ACCESS_TEAM_DOMAIN= CF_ACCESS_AUD= SECRET=smoke-secret \
  PORT=$PORT BASE_URL=$BASE DB_PATH=$DB \
  node src/server.js >/tmp/rsvp-smoke-server.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -f "$DB" "$JAR" "$JAR2"' EXIT

for i in $(seq 1 40); do
  curl -fsS "$BASE/" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS "$BASE/" >/dev/null 2>&1 || { echo "FAIL: server did not start"; echo "--- server log ---"; cat /tmp/rsvp-smoke-server.log; exit 1; }

pass=0; fail=0
ok(){ echo "  PASS: $1"; pass=$((pass+1)); }
no(){ echo "  FAIL: $1"; fail=$((fail+1)); }
csrf(){ grep -oP 'name="_csrf"[^>]*value="\K[^"]+' | head -n1; }

echo "Running checks…"

# 1. Create an open-link event (asks adults + kids, public list visibility)
CS=$(curl -fsS -c "$JAR" -b "$JAR" "$BASE/organiser/events/new" | csrf)
[ -n "$CS" ] && ok "got organiser CSRF token" || no "no organiser CSRF token"

LOC=$(curl -fsS -c "$JAR" -b "$JAR" -o /dev/null -w '%{redirect_url}' \
  --data-urlencode "_csrf=$CS" \
  --data-urlencode "title=Smoke Open Event" \
  --data-urlencode "date=2030-01-01" \
  --data-urlencode "time=18:00" \
  --data-urlencode "theme=modern" \
  --data-urlencode "access_mode=open_link" \
  --data-urlencode "ask_adults=on" \
  --data-urlencode "ask_kids=on" \
  --data-urlencode "public_visibility=list" \
  "$BASE/organiser/events")
echo "$LOC" | grep -q '/organiser/events/' && ok "event created -> $LOC" || no "event not created (got '$LOC')"

# 2. Manage page shows the shared /e/ link + card
MANAGE=$(curl -fsS -c "$JAR" -b "$JAR" "$LOC")
TOKEN=$(echo "$MANAGE" | grep -oP '/e/\K[A-Za-z0-9]+' | head -n1)
[ -n "$TOKEN" ] && ok "manage page exposes shared link (/e/$TOKEN)" || no "no shared link on manage page"
echo "$MANAGE" | grep -q 'Shared sign-up link' && ok "shared-link card present" || no "shared-link card missing"

if [ -z "$TOKEN" ]; then echo; echo "==== $pass passed, $fail failed (aborting: no token) ===="; exit 1; fi

# 3. Public page renders the form with adults + kids
PUB=$(curl -fsS -c "$JAR2" -b "$JAR2" "$BASE/e/$TOKEN")
echo "$PUB" | grep -q 'Are you coming' && ok "public page renders sign-up form" || no "public form missing"
echo "$PUB" | grep -q 'name="adults"' && ok "adults field present" || no "adults field missing"
echo "$PUB" | grep -q 'name="kids"'   && ok "kids field present"   || no "kids field missing"

# 4. Submit a sign-up (2 adults, 3 kids, yes)
PCS=$(echo "$PUB" | csrf)
DONE=$(curl -fsS -c "$JAR2" -b "$JAR2" -o /dev/null -w '%{redirect_url}' \
  --data-urlencode "_csrf=$PCS" \
  --data-urlencode "signup_name=Alice Tester" \
  --data-urlencode "rsvp=yes" \
  --data-urlencode "adults=2" \
  --data-urlencode "kids=3" \
  "$BASE/e/$TOKEN")
echo "$DONE" | grep -q 'done=1' && ok "sign-up accepted -> $DONE" || no "sign-up not accepted (got '$DONE')"

# 5. Public list shows the attendee with 2 adults / 3 kids
PUB2=$(curl -fsS -c "$JAR2" -b "$JAR2" "$BASE/e/$TOKEN?done=1")
echo "$PUB2" | grep -q 'Alice Tester' && ok "attendee appears on public list" || no "attendee missing from public list"
echo "$PUB2" | grep -q '2 adults' && ok "public list shows '2 adults'" || no "public list adults wrong"
echo "$PUB2" | grep -q '3 kids'   && ok "public list shows '3 kids'"   || no "public list kids wrong"

# 6. Manage page shows the sign-up + adults/kids totals + headcount
M2=$(curl -fsS -c "$JAR" -b "$JAR" "$LOC")
echo "$M2" | grep -q 'Alice Tester'  && ok "sign-up shows on manage page" || no "sign-up missing on manage page"
echo "$M2" | grep -q 'Sign-ups (1)'  && ok "manage header 'Sign-ups (1)'" || no "manage header/count wrong"
echo "$M2" | grep -q '2 adults'      && ok "manage totals show '2 adults'" || no "manage adults total missing"
echo "$M2" | grep -q '3 kids'        && ok "manage totals show '3 kids'"   || no "manage kids total missing"
echo "$M2" | grep -q '5</b> total coming' && ok "headcount = 5 (2 adults + 3 kids)" || no "headcount wrong"

echo
echo "==== $pass passed, $fail failed ===="
[ "$fail" -eq 0 ]
