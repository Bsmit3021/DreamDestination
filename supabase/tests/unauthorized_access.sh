#!/usr/bin/env bash
#
# DreamDestination — unauthorized access smoke test.
#
# Drives the real Auth and PostgREST endpoints with real JWTs, bypassing the
# application entirely, and asserts that the ownership model holds. This is the
# companion to rls_smoke.sql: that one tests policies from inside the database,
# this one tests them from outside, the way an attacker would.
#
# Usage (local stack only — it creates two users and leaves them behind):
#
#   npx supabase start
#   ./supabase/tests/unauthorized_access.sh
#
# Override the target if needed:
#   SUPABASE_URL=... SUPABASE_ANON_KEY=... ./supabase/tests/unauthorized_access.sh
#
# Do NOT run this against production: it signs up accounts.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/.env.local"

API="${SUPABASE_URL:-}"
ANON="${SUPABASE_ANON_KEY:-}"

if [ -z "$API" ] && [ -f "$ENV_FILE" ]; then
  API=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
fi
if [ -z "$ANON" ] && [ -f "$ENV_FILE" ]; then
  ANON=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' "$ENV_FILE" | cut -d= -f2-)
fi

if [ -z "$API" ] || [ -z "$ANON" ]; then
  echo "Set SUPABASE_URL and SUPABASE_ANON_KEY, or create .env.local" >&2
  exit 2
fi

# Unique per run so repeated runs do not collide on the email unique index.
STAMP=$(date +%s)
A_EMAIL="rls-a-$STAMP@dreamdest.test"
B_EMAIL="rls-b-$STAMP@dreamdest.test"
A_PW="alpha-password-$STAMP"
B_PW="bravo-password-$STAMP"

pass=0; fail=0
ok()  { echo "PASS  $1"; pass=$((pass+1)); }
bad() { echo "FAIL  $1  -> $2"; fail=$((fail+1)); }

signup() {
  curl -s -X POST "$API/auth/v1/signup" -H "apikey: $ANON" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" >/dev/null
}

token() {
  curl -s -X POST "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" |
    sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'
}

# Decode the `sub` claim so we never guess at user ids.
uid() {
  echo "$1" | cut -d. -f2 | tr '_-' '/+' |
    awk '{ while (length($0) % 4) $0 = $0 "="; print }' | base64 -d 2>/dev/null |
    sed -n 's/.*"sub":"\([^"]*\)".*/\1/p'
}

make_profile() { # token, user_id, occupation, city, state
  curl -s -o /dev/null -X POST "$API/rest/v1/profiles" -H "apikey: $ANON" \
    -H "Authorization: Bearer $1" -H "Content-Type: application/json" \
    -d "{\"user_id\":\"$2\",\"age_range\":\"35-44\",\"household_income\":90000,
         \"occupation\":\"$3\",\"relationship_status\":\"single\",\"children\":0,
         \"household_size\":1,\"current_city\":\"$4\",\"current_state\":\"$5\",
         \"housing_budget\":2500,\"work_preference\":\"hybrid\"}"
}

signup "$A_EMAIL" "$A_PW"
signup "$B_EMAIL" "$B_PW"
A_TOKEN=$(token "$A_EMAIL" "$A_PW")
B_TOKEN=$(token "$B_EMAIL" "$B_PW")

if [ -z "$A_TOKEN" ] || [ -z "$B_TOKEN" ]; then
  echo "Could not obtain tokens. Is the stack running, and is email confirmation off?" >&2
  exit 1
fi

A_ID=$(uid "$A_TOKEN"); B_ID=$(uid "$B_TOKEN")
make_profile "$A_TOKEN" "$A_ID" "A occupation" "Brooklyn" "NY"
make_profile "$B_TOKEN" "$B_ID" "B occupation" "Denver" "CO"

echo "--- anonymous visitor ---"

# Denial can come from the missing GRANT (42501) or from an RLS USING clause
# (empty set). Both are acceptable; returning a row is not.
for table in profiles preferences recommendations; do
  n=$(curl -s "$API/rest/v1/$table?select=id" -H "apikey: $ANON" | tr -d ' \n')
  if [ "$n" = "[]" ]; then
    ok "anon reading $table yields no rows (RLS)"
  elif echo "$n" | grep -q '42501'; then
    ok "anon reading $table denied at GRANT layer (42501)"
  else
    bad "anon read $table" "$n"
  fi
done

c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/cities" \
      -H "apikey: $ANON" -H "Content-Type: application/json" \
      -d '{"slug":"anon-hack","city":"X","state":"TX","latitude":1,"longitude":1}')
case "$c" in 401|403) ok "anon writing cities rejected (HTTP $c)";;
             *) bad "anon write cities" "HTTP $c";; esac

echo "--- user A's real token aimed at user B's data ---"

n=$(curl -s "$API/rest/v1/profiles?select=id&user_id=eq.$B_ID" \
      -H "apikey: $ANON" -H "Authorization: Bearer $A_TOKEN" | tr -d ' \n')
[ "$n" = "[]" ] && ok "A cannot read B's profile" || bad "A read B profile" "$n"

n=$(curl -s -X PATCH "$API/rest/v1/profiles?user_id=eq.$B_ID" \
      -H "apikey: $ANON" -H "Authorization: Bearer $A_TOKEN" \
      -H "Content-Type: application/json" -H "Prefer: return=representation" \
      -d '{"occupation":"HACKED"}' | tr -d ' \n')
[ "$n" = "[]" ] && ok "A updating B's profile affects 0 rows" \
                || bad "A update B profile" "$n"

n=$(curl -s -X DELETE "$API/rest/v1/profiles?user_id=eq.$B_ID" \
      -H "apikey: $ANON" -H "Authorization: Bearer $A_TOKEN" \
      -H "Prefer: return=representation" | tr -d ' \n')
[ "$n" = "[]" ] && ok "A deleting B's profile affects 0 rows" \
                || bad "A delete B profile" "$n"

c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/profiles" \
      -H "apikey: $ANON" -H "Authorization: Bearer $A_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"user_id\":\"$B_ID\",\"age_range\":\"25-34\",\"household_income\":1,
           \"occupation\":\"spoof\",\"relationship_status\":\"single\",\"children\":0,
           \"household_size\":1,\"current_city\":\"Q\",\"current_state\":\"NY\",
           \"housing_budget\":1,\"work_preference\":\"remote\"}")
case "$c" in 401|403) ok "A forging a profile owned by B rejected (HTTP $c)";;
             *) bad "A forge B profile" "HTTP $c";; esac

c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/recommendations" \
      -H "apikey: $ANON" -H "Authorization: Bearer $A_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"profile_id":"00000000-0000-0000-0000-000000000000",
           "city_id":"00000000-0000-0000-0000-000000000000",
           "dream_score":1,"rank":1}')
case "$c" in 401|403) ok "A fabricating a recommendation rejected (HTTP $c)";;
             *) bad "A write recommendation" "HTTP $c";; esac

c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/cities" \
      -H "apikey: $ANON" -H "Authorization: Bearer $A_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"slug":"user-hack","city":"X","state":"TX","latitude":1,"longitude":1}')
case "$c" in 401|403) ok "A writing city reference data rejected (HTTP $c)";;
             *) bad "A write cities" "HTTP $c";; esac

echo "--- legitimate access still works ---"

curl -s "$API/rest/v1/profiles?select=occupation" -H "apikey: $ANON" \
  -H "Authorization: Bearer $A_TOKEN" | grep -q "A occupation" \
  && ok "A can read their own profile" || bad "A read own profile" "denied"

curl -s "$API/rest/v1/profiles?select=occupation" -H "apikey: $ANON" \
  -H "Authorization: Bearer $B_TOKEN" | grep -q "B occupation" \
  && ok "B's profile survived A's attacks intact" || bad "B read own profile" "altered"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
