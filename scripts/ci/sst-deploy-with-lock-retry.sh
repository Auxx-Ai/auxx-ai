#!/usr/bin/env bash
# scripts/ci/sst-deploy-with-lock-retry.sh

set -u
set -o pipefail

# LOCK_PATTERN_ONE: first known SST lock failure message variant.
readonly LOCK_PATTERN_ONE='Concurrent update detected'
# LOCK_PATTERN_TWO: second known SST lock failure message variant.
readonly LOCK_PATTERN_TWO='A concurrent update was detected on the app.'

# DEPLOY_CMD: deploy command executed for each attempt.
DEPLOY_CMD="${SST_DEPLOY_CMD:-pnpm sst:deploy}"
# WAIT_SECONDS: delay before one lock retry.
WAIT_SECONDS="${SST_LOCK_WAIT_SECONDS:-90}"
# MAX_ATTEMPTS: total deploy attempts for lock errors.
MAX_ATTEMPTS="${SST_LOCK_MAX_ATTEMPTS:-2}"
# STAGE_NAME: SST stage displayed in logs and remediation guidance.
STAGE_NAME="${STAGE:-dev}"

# is_lock_failure checks if a deploy log contains an SST lock error.
is_lock_failure() {
  local log_file="$1"
  grep -Eq "${LOCK_PATTERN_ONE}|${LOCK_PATTERN_TWO}" "${log_file}"
}

# run_deploy_attempt executes the deploy command once and returns:
# 0 on success, 10 on lock failure, or the deploy command exit code.
run_deploy_attempt() {
  local attempt="$1"
  local log_file

  log_file="$(mktemp)"
  echo "Running SST deploy attempt ${attempt}/${MAX_ATTEMPTS}"
  echo "Command: ${DEPLOY_CMD}"

  bash -lc "${DEPLOY_CMD}" 2>&1 | tee "${log_file}"
  local deploy_exit_code=${PIPESTATUS[0]}

  if [ "${deploy_exit_code}" -eq 0 ]; then
    rm -f "${log_file}"
    return 0
  fi

  if is_lock_failure "${log_file}"; then
    rm -f "${log_file}"
    return 10
  fi

  rm -f "${log_file}"
  return "${deploy_exit_code}"
}

# main runs the lock-aware deploy flow with a single retry for lock errors.
main() {
  local attempt=1

  while [ "${attempt}" -le "${MAX_ATTEMPTS}" ]; do
    run_deploy_attempt "${attempt}"
    local attempt_exit_code=$?

    if [ "${attempt_exit_code}" -eq 0 ]; then
      echo "SST deploy succeeded on attempt ${attempt}/${MAX_ATTEMPTS}"
      return 0
    fi

    if [ "${attempt_exit_code}" -eq 10 ]; then
      if [ "${attempt}" -lt "${MAX_ATTEMPTS}" ]; then
        echo "Detected SST lock contention. Waiting ${WAIT_SECONDS}s before retry."
        sleep "${WAIT_SECONDS}"
        attempt=$((attempt + 1))
        continue
      fi

      echo "SST deploy failed after ${MAX_ATTEMPTS} attempts due to lock contention."
      echo "If no active deploy is running, unlock with:"
      echo "  pnpm exec sst unlock --stage=${STAGE_NAME}"
      echo "Then retry deploy."
      return 1
    fi

    echo "SST deploy failed with non-lock error (exit code: ${attempt_exit_code})."
    return "${attempt_exit_code}"
  done

  return 1
}

main "$@"
