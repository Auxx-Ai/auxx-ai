#!/usr/bin/env bash
# scripts/ci/sst-force-unlock.sh
#
# Best-effort SST lock cleanup for CI post-deploy steps.
# Tries `sst unlock` first, falls back to direct S3 lock file deletion.
# Always exits 0 — this is a cleanup script, not a gate.

set -u
set -o pipefail

STAGE_NAME="${STAGE:-dev}"
AWS_REGION="${AWS_REGION:-us-west-1}"
SST_APP_NAME="${SST_APP_NAME:-auxxai-app}"
UNLOCK_TIMEOUT="${SST_UNLOCK_TIMEOUT:-30}"

echo "=== SST force-unlock cleanup ==="
echo "Stage: ${STAGE_NAME}, Region: ${AWS_REGION}, App: ${SST_APP_NAME}"

# Attempt 1: sst unlock with timeout
echo "Attempting sst unlock (timeout: ${UNLOCK_TIMEOUT}s)..."
if timeout "${UNLOCK_TIMEOUT}" pnpm exec sst unlock --stage="${STAGE_NAME}" 2>&1; then
  echo "sst unlock succeeded."
  exit 0
fi
echo "sst unlock failed or timed out. Falling back to direct S3 lock deletion."

# Attempt 2: Direct S3 lock file deletion via bootstrap state bucket
# SST stores its state in an S3 bucket registered in SSM at /sst/bootstrap
BOOTSTRAP_JSON=$(aws ssm get-parameter \
  --name "/sst/bootstrap" \
  --region "${AWS_REGION}" \
  --query 'Parameter.Value' \
  --output text 2>/dev/null || true)

if [ -z "${BOOTSTRAP_JSON}" ]; then
  echo "Could not read /sst/bootstrap SSM parameter. Cannot determine state bucket."
  echo "Manual unlock may be required: pnpm exec sst unlock --stage=${STAGE_NAME}"
  exit 0
fi

STATE_BUCKET=$(echo "${BOOTSTRAP_JSON}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('state',''))" 2>/dev/null || true)

if [ -z "${STATE_BUCKET}" ]; then
  echo "Could not parse state bucket from bootstrap parameter."
  echo "Manual unlock may be required: pnpm exec sst unlock --stage=${STAGE_NAME}"
  exit 0
fi

LOCK_KEY="app/${SST_APP_NAME}/${STAGE_NAME}/.lock"
echo "Deleting lock object: s3://${STATE_BUCKET}/${LOCK_KEY}"

if aws s3 rm "s3://${STATE_BUCKET}/${LOCK_KEY}" --region "${AWS_REGION}" 2>&1; then
  echo "S3 lock file deleted successfully."
else
  echo "S3 lock file deletion failed (may not exist or insufficient permissions)."
  echo "Manual unlock may be required: pnpm exec sst unlock --stage=${STAGE_NAME}"
fi

exit 0
