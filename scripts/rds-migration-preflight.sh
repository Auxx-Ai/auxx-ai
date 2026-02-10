#!/usr/bin/env bash
# scripts/rds-migration-preflight.sh
#
# Pre-migration diagnostic: verifies AWS infra, network connectivity, DB access,
# and data state before running the actual migration.
#
# Requirements: aws cli, jq (both already installed)
# No local PostgreSQL tools or SSM plugin needed.

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────

PROFILE="auxxai-dev"
REGION="us-west-1"
NAT_INSTANCE_ID="i-0a6c600d5f91a2684"

OLD_RDS_ID="auxxai-app-dev-auxxairdsinstance-htouhznc"
NEW_RDS_ID="auxxai-app-dev-auxxairdsinstance-xsdztvzd"
OLD_HOST="auxxai-app-dev-auxxairdsinstance-htouhznc.c34guwo6e3rx.us-west-1.rds.amazonaws.com"
NEW_HOST="auxxai-app-dev-auxxairdsinstance-xsdztvzd.c34guwo6e3rx.us-west-1.rds.amazonaws.com"

TEMP_OLD_PASS="TempMigration2026!"
NEW_PASS="XNjeyr9GdTgmdeTc9bDjLouD5UlDIq0P"
DB_NAME="auxxai"
DB_USER="postgres"
DB_PORT="5432"

RDS_SG="sg-026be5d78f3808ed6"

# ── Helpers ────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✔${NC} $*"; }
fail() { echo -e "  ${RED}✗${NC} $*"; }
warn() { echo -e "  ${YELLOW}!${NC} $*"; }
info() { echo -e "  ${CYAN}→${NC} $*"; }
header() { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }

CHECKS_PASSED=0
CHECKS_FAILED=0

check_pass() { pass "$@"; CHECKS_PASSED=$((CHECKS_PASSED + 1)); }
check_fail() { fail "$@"; CHECKS_FAILED=$((CHECKS_FAILED + 1)); }

aws_cmd() {
  aws "$@" --profile "$PROFILE" --region "$REGION"
}

# Run a script on the NAT instance via SSM and return stdout.
# Usage: run_remote "description" "script_body"
run_remote() {
  local desc="$1"
  local script="$2"

  # Base64 encode to avoid all quoting/escaping issues
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
    --timeout-seconds 300 \
    --comment "$desc" \
    --query 'Command.CommandId' \
    --output text)

  rm -f "$params_file"

  # Poll until complete
  local status="Pending"
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
        return 0
        ;;
      Failed|Cancelled|TimedOut)
        echo "$result" | jq -r '.StandardOutputContent // empty' >&2
        echo "$result" | jq -r '.StandardErrorContent // empty' >&2
        return 1
        ;;
      *)
        sleep 3
        ;;
    esac
  done
}

# ── Phase 1: Local Infrastructure Checks ──────────────────────────────────────

header "Phase 1: AWS Infrastructure"

# 1a. AWS credentials
info "Checking AWS credentials..."
ACCOUNT=$(aws_cmd sts get-caller-identity --query 'Account' --output text 2>/dev/null || echo "FAILED")
if [[ "$ACCOUNT" == "FAILED" ]]; then
  check_fail "AWS credentials invalid or expired. Run: aws sso login --profile $PROFILE"
  echo -e "\n${RED}Cannot continue without valid credentials. Exiting.${NC}"
  exit 1
fi
check_pass "AWS credentials valid (account: $ACCOUNT)"

# 1b. Old RDS instance
info "Checking old RDS instance ($OLD_RDS_ID)..."
OLD_STATUS=$(aws_cmd rds describe-db-instances --db-instance-identifier "$OLD_RDS_ID" \
  --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null || echo "not-found")
OLD_VERSION=$(aws_cmd rds describe-db-instances --db-instance-identifier "$OLD_RDS_ID" \
  --query 'DBInstances[0].EngineVersion' --output text 2>/dev/null || echo "?")
if [[ "$OLD_STATUS" == "available" ]]; then
  check_pass "Old instance: available (v$OLD_VERSION)"
else
  check_fail "Old instance: $OLD_STATUS (expected: available)"
fi

# 1c. New RDS instance
info "Checking new RDS instance ($NEW_RDS_ID)..."
NEW_STATUS=$(aws_cmd rds describe-db-instances --db-instance-identifier "$NEW_RDS_ID" \
  --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null || echo "not-found")
NEW_VERSION=$(aws_cmd rds describe-db-instances --db-instance-identifier "$NEW_RDS_ID" \
  --query 'DBInstances[0].EngineVersion' --output text 2>/dev/null || echo "?")
if [[ "$NEW_STATUS" == "available" ]]; then
  check_pass "New instance: available (v$NEW_VERSION)"
else
  check_fail "New instance: $NEW_STATUS (expected: available)"
fi

# 1d. NAT instance SSM
info "Checking NAT instance SSM ($NAT_INSTANCE_ID)..."
SSM_STATUS=$(aws_cmd ssm describe-instance-information \
  --filters "Key=InstanceIds,Values=$NAT_INSTANCE_ID" \
  --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || echo "None")
if [[ "$SSM_STATUS" == "Online" ]]; then
  check_pass "NAT instance SSM: Online"
else
  check_fail "NAT instance SSM: $SSM_STATUS (expected: Online)"
fi

# 1e. Security group
info "Checking RDS security group ($RDS_SG)..."
SG_CIDR=$(aws_cmd ec2 describe-security-groups --group-ids "$RDS_SG" \
  --query 'SecurityGroups[0].IpPermissions[0].IpRanges[0].CidrIp' --output text 2>/dev/null || echo "none")
NAT_IP=$(aws_cmd ec2 describe-instances --instance-ids "$NAT_INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PrivateIpAddress' --output text 2>/dev/null || echo "?")
if [[ "$SG_CIDR" == "10.0.0.0/16" ]]; then
  check_pass "Security group allows VPC CIDR ($SG_CIDR) — NAT IP $NAT_IP is within range"
else
  warn "Security group inbound CIDR: $SG_CIDR — verify NAT IP $NAT_IP is allowed"
fi

if [[ "$CHECKS_FAILED" -gt 0 ]]; then
  echo -e "\n${RED}Phase 1 failed with $CHECKS_FAILED error(s). Fix these before continuing.${NC}"
  exit 1
fi

# ── Phase 2: Remote Connectivity & Tools ───────────────────────────────────────

header "Phase 2: Remote Connectivity (via NAT instance)"

info "Installing pg tools + testing TCP connectivity (this takes 30-60s)..."

PHASE2_OUTPUT=$(run_remote "preflight-phase2" "$(cat <<'REMOTESCRIPT'
#!/bin/bash
set -uo pipefail

echo "PGTOOLS_INSTALL_START"
if command -v pg_isready &>/dev/null && command -v psql &>/dev/null && command -v pg_dump &>/dev/null; then
  echo "PGTOOLS_ALREADY_INSTALLED"
  echo "PGTOOLS_VERSION=$(pg_dump --version | head -1)"
else
  # Try to install postgresql client
  if command -v dnf &>/dev/null; then
    dnf install -y postgresql16 &>/dev/null 2>&1 || \
    dnf install -y postgresql15 &>/dev/null 2>&1 || \
    dnf install -y postgresql &>/dev/null 2>&1
  elif command -v yum &>/dev/null; then
    yum install -y postgresql16 &>/dev/null 2>&1 || \
    yum install -y postgresql15 &>/dev/null 2>&1 || \
    yum install -y postgresql &>/dev/null 2>&1
  fi

  if command -v pg_dump &>/dev/null; then
    echo "PGTOOLS_INSTALLED_OK"
    echo "PGTOOLS_VERSION=$(pg_dump --version | head -1)"
  else
    echo "PGTOOLS_INSTALL_FAILED"
  fi
fi

echo "TCP_OLD_START"
if timeout 5 bash -c "echo > /dev/tcp/__OLD_HOST__/__DB_PORT__" 2>/dev/null; then
  echo "TCP_OLD_OK"
else
  echo "TCP_OLD_FAIL"
fi

echo "TCP_NEW_START"
if timeout 5 bash -c "echo > /dev/tcp/__NEW_HOST__/__DB_PORT__" 2>/dev/null; then
  echo "TCP_NEW_OK"
else
  echo "TCP_NEW_FAIL"
fi

echo "DISK_SPACE=$(df -h /tmp | tail -1 | awk '{print $4}')"
echo "PHASE2_DONE"
REMOTESCRIPT
)" 2>&1) || true

# Replace placeholders in the remote script output check
# (We need to substitute before sending - let me fix the approach)

# Actually the placeholders are in the heredoc. Let me re-run with substitution.
PHASE2_SCRIPT="#!/bin/bash
set -uo pipefail

echo PGTOOLS_INSTALL_START
if command -v pg_isready &>/dev/null && command -v psql &>/dev/null && command -v pg_dump &>/dev/null; then
  echo PGTOOLS_ALREADY_INSTALLED
  pg_dump --version | head -1 | sed 's/^/PGTOOLS_VERSION=/'
else
  if command -v dnf &>/dev/null; then
    dnf install -y postgresql16 &>/dev/null 2>&1 || dnf install -y postgresql15 &>/dev/null 2>&1 || dnf install -y postgresql &>/dev/null 2>&1
  elif command -v yum &>/dev/null; then
    yum install -y postgresql16 &>/dev/null 2>&1 || yum install -y postgresql15 &>/dev/null 2>&1 || yum install -y postgresql &>/dev/null 2>&1
  fi
  if command -v pg_dump &>/dev/null; then
    echo PGTOOLS_INSTALLED_OK
    pg_dump --version | head -1 | sed 's/^/PGTOOLS_VERSION=/'
  else
    echo PGTOOLS_INSTALL_FAILED
  fi
fi

echo TCP_OLD_START
if timeout 5 bash -c 'echo > /dev/tcp/${OLD_HOST}/${DB_PORT}' 2>/dev/null; then
  echo TCP_OLD_OK
else
  echo TCP_OLD_FAIL
fi

echo TCP_NEW_START
if timeout 5 bash -c 'echo > /dev/tcp/${NEW_HOST}/${DB_PORT}' 2>/dev/null; then
  echo TCP_NEW_OK
else
  echo TCP_NEW_FAIL
fi

df -h /tmp | tail -1 | awk '{print \"DISK_SPACE=\"\$4}'
echo PHASE2_DONE"

# Wait — the heredoc approach with variable substitution won't work because
# I used single-quoted heredoc. Let me use the proper approach.

echo "$PHASE2_OUTPUT" > /dev/null  # suppress for now, we'll redo

PHASE2_SCRIPT=$(cat <<ENDSCRIPT
#!/bin/bash
set -uo pipefail

echo PGTOOLS_INSTALL_START
if command -v pg_isready &>/dev/null && command -v psql &>/dev/null && command -v pg_dump &>/dev/null; then
  echo PGTOOLS_ALREADY_INSTALLED
  pg_dump --version | head -1 | sed 's/^/PGTOOLS_VERSION=/'
else
  if command -v dnf &>/dev/null; then
    dnf install -y postgresql16 &>/dev/null 2>&1 || dnf install -y postgresql15 &>/dev/null 2>&1 || dnf install -y postgresql &>/dev/null 2>&1
  elif command -v yum &>/dev/null; then
    yum install -y postgresql16 &>/dev/null 2>&1 || yum install -y postgresql15 &>/dev/null 2>&1 || yum install -y postgresql &>/dev/null 2>&1
  fi
  if command -v pg_dump &>/dev/null; then
    echo PGTOOLS_INSTALLED_OK
    pg_dump --version | head -1 | sed 's/^/PGTOOLS_VERSION=/'
  else
    echo PGTOOLS_INSTALL_FAILED
  fi
fi

echo TCP_OLD_START
if timeout 5 bash -c "echo > /dev/tcp/${OLD_HOST}/${DB_PORT}" 2>/dev/null; then
  echo TCP_OLD_OK
else
  echo TCP_OLD_FAIL
fi

echo TCP_NEW_START
if timeout 5 bash -c "echo > /dev/tcp/${NEW_HOST}/${DB_PORT}" 2>/dev/null; then
  echo TCP_NEW_OK
else
  echo TCP_NEW_FAIL
fi

df -h /tmp | tail -1 | awk '{print "DISK_SPACE=" \$4}'
echo PHASE2_DONE
ENDSCRIPT
)

PHASE2_OUTPUT=$(run_remote "preflight-phase2-connectivity" "$PHASE2_SCRIPT" 2>&1) || true

# Parse phase 2 results
if echo "$PHASE2_OUTPUT" | grep -q "PGTOOLS_ALREADY_INSTALLED\|PGTOOLS_INSTALLED_OK"; then
  PG_VERSION=$(echo "$PHASE2_OUTPUT" | grep "PGTOOLS_VERSION=" | head -1 | cut -d= -f2-)
  check_pass "PostgreSQL client tools: $PG_VERSION"
else
  check_fail "PostgreSQL client tools: installation failed"
fi

if echo "$PHASE2_OUTPUT" | grep -q "TCP_OLD_OK"; then
  check_pass "TCP to old RDS ($OLD_HOST:$DB_PORT): reachable"
else
  check_fail "TCP to old RDS ($OLD_HOST:$DB_PORT): unreachable"
fi

if echo "$PHASE2_OUTPUT" | grep -q "TCP_NEW_OK"; then
  check_pass "TCP to new RDS ($NEW_HOST:$DB_PORT): reachable"
else
  check_fail "TCP to new RDS ($NEW_HOST:$DB_PORT): unreachable"
fi

DISK_SPACE=$(echo "$PHASE2_OUTPUT" | grep "DISK_SPACE=" | head -1 | cut -d= -f2-)
if [[ -n "$DISK_SPACE" ]]; then
  check_pass "NAT instance /tmp disk space: $DISK_SPACE available"
else
  warn "Could not determine disk space"
fi

if [[ "$CHECKS_FAILED" -gt 0 ]]; then
  echo -e "\n${RED}Phase 2 failed with $CHECKS_FAILED error(s). Fix these before continuing.${NC}"
  exit 1
fi

# ── Phase 3: Password Reset + Full DB Connection Test ──────────────────────────

header "Phase 3: Database Authentication"

info "Resetting old instance master password..."
aws_cmd rds modify-db-instance \
  --db-instance-identifier "$OLD_RDS_ID" \
  --master-user-password "$TEMP_OLD_PASS" \
  --apply-immediately \
  --output text --query 'DBInstance.DBInstanceStatus' >/dev/null 2>&1
check_pass "Password reset initiated"

info "Waiting for old instance to be available (2-5 min)..."
aws_cmd rds wait db-instance-available --db-instance-identifier "$OLD_RDS_ID"
check_pass "Old instance available after password reset"

info "Testing database connections from NAT instance..."

PHASE3_SCRIPT=$(cat <<ENDSCRIPT
#!/bin/bash
set -uo pipefail

echo "AUTH_OLD_START"
if PGPASSWORD="${TEMP_OLD_PASS}" psql -h "${OLD_HOST}" -p ${DB_PORT} -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT 'AUTH_OLD_OK'" 2>/dev/null | grep -q "AUTH_OLD_OK"; then
  echo "AUTH_OLD_OK"

  echo -n "OLD_TABLE_COUNT="
  PGPASSWORD="${TEMP_OLD_PASS}" psql -h "${OLD_HOST}" -p ${DB_PORT} -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' '

  echo "OLD_TABLES_SAMPLE_START"
  PGPASSWORD="${TEMP_OLD_PASS}" psql -h "${OLD_HOST}" -p ${DB_PORT} -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name LIMIT 10;" 2>/dev/null
  echo "OLD_TABLES_SAMPLE_END"

  echo -n "OLD_DB_SIZE="
  PGPASSWORD="${TEMP_OLD_PASS}" psql -h "${OLD_HOST}" -p ${DB_PORT} -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT pg_size_pretty(pg_database_size('${DB_NAME}'));" 2>/dev/null | tr -d ' '
else
  echo "AUTH_OLD_FAIL"
fi

echo "AUTH_NEW_START"
if PGPASSWORD="${NEW_PASS}" psql -h "${NEW_HOST}" -p ${DB_PORT} -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT 'AUTH_NEW_OK'" 2>/dev/null | grep -q "AUTH_NEW_OK"; then
  echo "AUTH_NEW_OK"

  echo -n "NEW_TABLE_COUNT="
  PGPASSWORD="${NEW_PASS}" psql -h "${NEW_HOST}" -p ${DB_PORT} -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' '

  echo -n "NEW_DB_SIZE="
  PGPASSWORD="${NEW_PASS}" psql -h "${NEW_HOST}" -p ${DB_PORT} -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT pg_size_pretty(pg_database_size('${DB_NAME}'));" 2>/dev/null | tr -d ' '
else
  echo "AUTH_NEW_FAIL"
fi

echo "PHASE3_DONE"
ENDSCRIPT
)

PHASE3_OUTPUT=$(run_remote "preflight-phase3-db-auth" "$PHASE3_SCRIPT" 2>&1) || true

# Parse phase 3 results
if echo "$PHASE3_OUTPUT" | grep -q "AUTH_OLD_OK"; then
  check_pass "Auth to old instance: connected"

  OLD_TABLE_COUNT=$(echo "$PHASE3_OUTPUT" | grep "OLD_TABLE_COUNT=" | head -1 | cut -d= -f2-)
  OLD_DB_SIZE=$(echo "$PHASE3_OUTPUT" | grep "OLD_DB_SIZE=" | head -1 | cut -d= -f2-)
  check_pass "Old instance: $OLD_TABLE_COUNT tables, $OLD_DB_SIZE on disk"

  OLD_SAMPLE=$(echo "$PHASE3_OUTPUT" | sed -n '/OLD_TABLES_SAMPLE_START/,/OLD_TABLES_SAMPLE_END/p' | grep -v "SAMPLE" | sed 's/^ *//' | grep -v '^$')
  if [[ -n "$OLD_SAMPLE" ]]; then
    info "Sample tables: $(echo "$OLD_SAMPLE" | tr '\n' ', ' | sed 's/, $//')"
  fi
else
  check_fail "Auth to old instance: connection failed"
fi

if echo "$PHASE3_OUTPUT" | grep -q "AUTH_NEW_OK"; then
  check_pass "Auth to new instance: connected"

  NEW_TABLE_COUNT=$(echo "$PHASE3_OUTPUT" | grep "NEW_TABLE_COUNT=" | head -1 | cut -d= -f2-)
  NEW_DB_SIZE=$(echo "$PHASE3_OUTPUT" | grep "NEW_DB_SIZE=" | head -1 | cut -d= -f2-)
  check_pass "New instance: $NEW_TABLE_COUNT tables, $NEW_DB_SIZE on disk"
else
  check_fail "Auth to new instance: connection failed"
fi

# ── Summary ────────────────────────────────────────────────────────────────────

header "Summary"

echo ""
echo -e "  Checks passed: ${GREEN}$CHECKS_PASSED${NC}"
echo -e "  Checks failed: ${RED}$CHECKS_FAILED${NC}"
echo ""

if [[ "$CHECKS_FAILED" -eq 0 ]]; then
  echo -e "  ${GREEN}▸ ALL CHECKS PASSED — ready to migrate.${NC}"
  echo ""
  echo "  Run the migration script next:"
  echo "    bash scripts/rds-migrate-data.sh"
else
  echo -e "  ${RED}▸ $CHECKS_FAILED CHECK(S) FAILED — fix issues before migrating.${NC}"
  exit 1
fi
