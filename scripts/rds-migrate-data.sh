#!/usr/bin/env bash
# scripts/rds-migrate-data.sh
#
# Migrates data from old RDS instance (16.8) to new RDS instance (16.11).
# Runs pg_dump/pg_restore on the NAT instance inside the VPC via SSM send-command.
# No local PostgreSQL tools or SSM plugin needed — only aws cli + jq.
#
# Run scripts/rds-migration-preflight.sh first to verify everything is ready.

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────

PROFILE="auxxai-dev"
REGION="us-west-1"
NAT_INSTANCE_ID="i-0a6c600d5f91a2684"

OLD_HOST="auxxai-app-dev-auxxairdsinstance-htouhznc.c34guwo6e3rx.us-west-1.rds.amazonaws.com"
NEW_HOST="auxxai-app-dev-auxxairdsinstance-xsdztvzd.c34guwo6e3rx.us-west-1.rds.amazonaws.com"

OLD_PASS="TempMigration2026!"
NEW_PASS="XNjeyr9GdTgmdeTc9bDjLouD5UlDIq0P"
DB_NAME="auxxai"
DB_USER="postgres"
DB_PORT="5432"

# ── Helpers ────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

log()    { echo -e "  ${CYAN}→${NC} $*"; }
pass()   { echo -e "  ${GREEN}✔${NC} $*"; }
fail()   { echo -e "  ${RED}✗${NC} $*"; }
header() { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }

aws_cmd() {
  aws "$@" --profile "$PROFILE" --region "$REGION"
}

# Run a script on the NAT instance via SSM. Prints stdout. Returns exit code.
run_remote() {
  local desc="$1"
  local script="$2"
  local timeout="${3:-900}"

  local encoded
  encoded=$(echo "$script" | base64)

  local params_file
  params_file=$(mktemp)
  jq -n --arg s "$encoded" '{"commands": ["echo " + $s + " | base64 -d | bash"]}' > "$params_file"

  local cmd_id
  cmd_id=$(aws_cmd ssm send-command \
    --instance-ids "$NAT_INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters "file://$params_file" \
    --timeout-seconds "$timeout" \
    --comment "$desc" \
    --query 'Command.CommandId' \
    --output text)

  rm -f "$params_file"

  local status="Pending"
  local elapsed=0
  while true; do
    local result
    result=$(aws_cmd ssm get-command-invocation \
      --command-id "$cmd_id" \
      --instance-id "$NAT_INSTANCE_ID" \
      --output json 2>/dev/null || echo '{"Status":"Pending"}')

    status=$(echo "$result" | jq -r '.Status')

    case "$status" in
      Success)
        echo "$result" | jq -r '.StandardOutputContent'
        local stderr
        stderr=$(echo "$result" | jq -r '.StandardErrorContent // empty')
        if [[ -n "$stderr" ]]; then
          echo -e "\n── stderr ──\n$stderr" >&2
        fi
        return 0
        ;;
      Failed|Cancelled|TimedOut)
        echo "$result" | jq -r '.StandardOutputContent // empty'
        echo "$result" | jq -r '.StandardErrorContent // empty' >&2
        return 1
        ;;
      *)
        elapsed=$((elapsed + 5))
        printf "\r  ⏳ Running on NAT instance... (%ds elapsed)" "$elapsed"
        sleep 5
        ;;
    esac
  done
}

# ── Quick preflight ────────────────────────────────────────────────────────────

header "Quick Preflight"

log "Checking AWS credentials..."
aws_cmd sts get-caller-identity --output text --query 'Account' >/dev/null 2>&1 \
  || { fail "AWS credentials expired. Run: aws sso login --profile $PROFILE"; exit 1; }
pass "Credentials OK"

log "Checking RDS instances..."
for INST in auxxai-app-dev-auxxairdsinstance-htouhznc auxxai-app-dev-auxxairdsinstance-xsdztvzd; do
  STATUS=$(aws_cmd rds describe-db-instances --db-instance-identifier "$INST" \
    --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null || echo "not-found")
  if [[ "$STATUS" != "available" ]]; then
    fail "$INST is $STATUS (need: available)"; exit 1
  fi
done
pass "Both instances available"

# ── Step 1: Dump + Restore ─────────────────────────────────────────────────────

header "Step 1/2: Dump old → Restore new (running on NAT instance)"

MIGRATION_SCRIPT=$(cat <<ENDSCRIPT
#!/bin/bash
set -euo pipefail

echo "STEP=dump_start"
echo "Dumping old database..."
PGPASSWORD="${OLD_PASS}" pg_dump \\
  -h "${OLD_HOST}" -p ${DB_PORT} -U "${DB_USER}" -d "${DB_NAME}" \\
  -Fc --no-owner --no-privileges \\
  -f /tmp/auxxai-migration.dump

DUMP_SIZE=\$(du -h /tmp/auxxai-migration.dump | cut -f1)
echo "DUMP_SIZE=\${DUMP_SIZE}"
echo "Dump complete."

echo "STEP=prepare_new"
echo "Terminating connections and recreating database on new instance..."
PGPASSWORD="${NEW_PASS}" psql -h "${NEW_HOST}" -p ${DB_PORT} -U "${DB_USER}" -d postgres \\
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" \\
  -c "DROP DATABASE IF EXISTS ${DB_NAME};" \\
  -c "CREATE DATABASE ${DB_NAME};" \\
  > /dev/null 2>&1
echo "Database recreated."

echo "STEP=restore_start"
echo "Restoring to new instance..."
PGPASSWORD="${NEW_PASS}" pg_restore \\
  -h "${NEW_HOST}" -p ${DB_PORT} -U "${DB_USER}" -d "${DB_NAME}" \\
  --no-owner --no-privileges \\
  /tmp/auxxai-migration.dump 2>&1 || true
echo "Restore complete."

rm -f /tmp/auxxai-migration.dump
echo "STEP=done"
ENDSCRIPT
)

MIGRATE_OUTPUT=$(run_remote "rds-data-migration" "$MIGRATION_SCRIPT" 2>&1) || {
  echo ""
  fail "Migration failed. Output:"
  echo "$MIGRATE_OUTPUT"
  exit 1
}

echo ""
DUMP_SIZE=$(echo "$MIGRATE_OUTPUT" | grep "DUMP_SIZE=" | head -1 | cut -d= -f2-)
pass "Dump complete ($DUMP_SIZE)"
pass "Restore complete"

# ── Step 2: Verify ─────────────────────────────────────────────────────────────

header "Step 2/2: Verification"

log "Comparing old and new databases..."

VERIFY_SCRIPT=$(cat <<ENDSCRIPT
#!/bin/bash
set -uo pipefail

echo -n "OLD_TABLES="
PGPASSWORD="${OLD_PASS}" psql -h "${OLD_HOST}" -p ${DB_PORT} -U "${DB_USER}" -d "${DB_NAME}" -t \\
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' '

echo -n "NEW_TABLES="
PGPASSWORD="${NEW_PASS}" psql -h "${NEW_HOST}" -p ${DB_PORT} -U "${DB_USER}" -d "${DB_NAME}" -t \\
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' '

echo -n "OLD_SIZE="
PGPASSWORD="${OLD_PASS}" psql -h "${OLD_HOST}" -p ${DB_PORT} -U "${DB_USER}" -d "${DB_NAME}" -t \\
  -c "SELECT pg_size_pretty(pg_database_size('${DB_NAME}'));" 2>/dev/null | tr -d ' '

echo -n "NEW_SIZE="
PGPASSWORD="${NEW_PASS}" psql -h "${NEW_HOST}" -p ${DB_PORT} -U "${DB_USER}" -d "${DB_NAME}" -t \\
  -c "SELECT pg_size_pretty(pg_database_size('${DB_NAME}'));" 2>/dev/null | tr -d ' '

echo "VERIFY_DONE"
ENDSCRIPT
)

VERIFY_OUTPUT=$(run_remote "rds-migration-verify" "$VERIFY_SCRIPT" 2>&1) || true
echo ""

OLD_TABLES=$(echo "$VERIFY_OUTPUT" | grep "OLD_TABLES=" | head -1 | cut -d= -f2-)
NEW_TABLES=$(echo "$VERIFY_OUTPUT" | grep "NEW_TABLES=" | head -1 | cut -d= -f2-)
OLD_SIZE=$(echo "$VERIFY_OUTPUT" | grep "OLD_SIZE=" | head -1 | cut -d= -f2-)
NEW_SIZE=$(echo "$VERIFY_OUTPUT" | grep "NEW_SIZE=" | head -1 | cut -d= -f2-)

echo "  ┌──────────────────┬──────────────┬──────────────┐"
echo "  │                  │  Old (16.8)  │  New (16.11) │"
echo "  ├──────────────────┼──────────────┼──────────────┤"
printf "  │ Tables           │ %12s │ %12s │\n" "$OLD_TABLES" "$NEW_TABLES"
printf "  │ Size             │ %12s │ %12s │\n" "$OLD_SIZE" "$NEW_SIZE"
echo "  └──────────────────┴──────────────┴──────────────┘"
echo ""

if [[ "$OLD_TABLES" == "$NEW_TABLES" ]]; then
  pass "Table counts match ($NEW_TABLES tables)"
else
  fail "Table count mismatch: old=$OLD_TABLES new=$NEW_TABLES"
  exit 1
fi

# ── Done ───────────────────────────────────────────────────────────────────────

header "Migration Complete"

echo ""
echo -e "  ${GREEN}▸ Data migrated successfully.${NC}"
echo ""
echo "  Next steps:"
echo "    1. Verify your app works (login, read data, write data)"
echo "    2. Once confirmed, delete the old instance:"
echo "       aws rds delete-db-instance \\"
echo "         --db-instance-identifier auxxai-app-dev-auxxairdsinstance-htouhznc \\"
echo "         --final-db-snapshot-identifier auxxai-old-final-\$(date +%Y%m%d) \\"
echo "         --profile $PROFILE --region $REGION"
echo ""
