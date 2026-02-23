#!/usr/bin/env bash
# scripts/ci/sst-deploy-with-lock-retry.sh

set -u
set -o pipefail

# LOCK_PATTERN_ONE: first known SST lock failure message variant.
readonly LOCK_PATTERN_ONE='Concurrent update detected'
# LOCK_PATTERN_TWO: second known SST lock failure message variant.
readonly LOCK_PATTERN_TWO='A concurrent update was detected on the app.'
# LOCK_FAILURE_EXIT_CODE: internal status used when SST lock contention is detected.
readonly LOCK_FAILURE_EXIT_CODE=10

# DEPLOY_CMD: deploy command executed for each attempt.
DEPLOY_CMD="${SST_DEPLOY_CMD:-pnpm sst:deploy}"
# WAIT_SECONDS: delay before one lock retry.
WAIT_SECONDS="${SST_LOCK_WAIT_SECONDS:-90}"
# MAX_ATTEMPTS: total deploy attempts for lock errors.
MAX_ATTEMPTS="${SST_LOCK_MAX_ATTEMPTS:-3}"
# STAGE_NAME: SST stage displayed in logs and remediation guidance.
STAGE_NAME="${STAGE:-dev}"
# AUTO_UNLOCK_ON_FINAL_LOCK: enables one guarded unlock + final deploy retry after lock retries are exhausted.
AUTO_UNLOCK_ON_FINAL_LOCK="${SST_LOCK_AUTO_UNLOCK_ON_FINAL_LOCK:-true}"
# POST_UNLOCK_WAIT_SECONDS: optional delay after unlock before the final deploy retry.
POST_UNLOCK_WAIT_SECONDS="${SST_LOCK_POST_UNLOCK_WAIT_SECONDS:-15}"
# UNLOCK_CMD: command used when auto-unlock is enabled.
UNLOCK_CMD="${SST_UNLOCK_CMD:-pnpm exec sst unlock --stage=${STAGE_NAME}}"
# ENABLE_SIGNAL_UNLOCK_TRAP: attempts a best-effort unlock when SIGTERM/SIGINT is received.
ENABLE_SIGNAL_UNLOCK_TRAP="${SST_ENABLE_SIGNAL_UNLOCK_TRAP:-true}"

# is_lock_failure checks if a deploy log contains an SST lock error.
is_lock_failure() {
  local log_file="$1"
  grep -Eq "${LOCK_PATTERN_ONE}|${LOCK_PATTERN_TWO}" "${log_file}"
}

# is_truthy returns success for common true-like env values.
is_truthy() {
  local value="${1:-}"
  case "${value,,}" in
    1|true|yes|y|on) return 0 ;;
    *) return 1 ;;
  esac
}

# run_deploy_attempt executes the deploy command once and returns:
# 0 on success, 10 on lock failure, or the deploy command exit code.
run_deploy_attempt() {
  local attempt="$1"
  local log_file

  log_file="$(mktemp)"
  echo "Running SST deploy attempt ${attempt} (max lock attempts: ${MAX_ATTEMPTS})"
  echo "Command: ${DEPLOY_CMD}"

  bash -lc "${DEPLOY_CMD}" 2>&1 | tee "${log_file}"
  local deploy_exit_code=${PIPESTATUS[0]}

  if [ "${deploy_exit_code}" -eq 0 ]; then
    rm -f "${log_file}"
    return 0
  fi

  if is_lock_failure "${log_file}"; then
    rm -f "${log_file}"
    return "${LOCK_FAILURE_EXIT_CODE}"
  fi

  rm -f "${log_file}"
  return "${deploy_exit_code}"
}

# run_unlock_attempt executes the configured unlock command once.
run_unlock_attempt() {
  echo "Running SST unlock command to clear a potentially stale lock."
  echo "Command: ${UNLOCK_CMD}"
  bash -lc "${UNLOCK_CMD}"
  local unlock_exit_code=$?
  if [ "${unlock_exit_code}" -eq 0 ]; then
    echo "SST unlock command succeeded."
    return 0
  fi
  echo "SST unlock command failed (exit code: ${unlock_exit_code})."
  return "${unlock_exit_code}"
}

# handle_signal performs best-effort unlock cleanup when the process is interrupted.
handle_signal() {
  local signal_name="$1"
  echo "Received ${signal_name}. Attempting best-effort SST unlock cleanup."
  run_unlock_attempt || true
  exit 143
}

# main runs the lock-aware deploy flow with a single retry for lock errors.
main() {
  if is_truthy "${ENABLE_SIGNAL_UNLOCK_TRAP}"; then
    trap 'handle_signal SIGTERM' SIGTERM
    trap 'handle_signal SIGINT' SIGINT
  fi

  local attempt=1

  while [ "${attempt}" -le "${MAX_ATTEMPTS}" ]; do
    run_deploy_attempt "${attempt}"
    local attempt_exit_code=$?

    if [ "${attempt_exit_code}" -eq 0 ]; then
      echo "SST deploy succeeded on attempt ${attempt}/${MAX_ATTEMPTS}"
      return 0
    fi

    if [ "${attempt_exit_code}" -eq "${LOCK_FAILURE_EXIT_CODE}" ]; then
      if [ "${attempt}" -lt "${MAX_ATTEMPTS}" ]; then
        echo "Detected SST lock contention. Waiting ${WAIT_SECONDS}s before retry."
        sleep "${WAIT_SECONDS}"
        attempt=$((attempt + 1))
        continue
      fi

      if is_truthy "${AUTO_UNLOCK_ON_FINAL_LOCK}"; then
        echo "Lock contention persisted after ${MAX_ATTEMPTS} attempts."
        echo "Auto-unlock is enabled. Attempting one guarded unlock and final deploy retry."

        run_unlock_attempt
        local unlock_exit_code=$?
        if [ "${unlock_exit_code}" -eq 0 ]; then
          if [[ "${POST_UNLOCK_WAIT_SECONDS}" =~ ^[0-9]+$ ]] && [ "${POST_UNLOCK_WAIT_SECONDS}" -gt 0 ]; then
            echo "Waiting ${POST_UNLOCK_WAIT_SECONDS}s after unlock before final deploy retry."
            sleep "${POST_UNLOCK_WAIT_SECONDS}"
          fi

          run_deploy_attempt "post-unlock"
          local post_unlock_exit_code=$?
          if [ "${post_unlock_exit_code}" -eq 0 ]; then
            echo "SST deploy succeeded on post-unlock attempt."
            return 0
          fi

          if [ "${post_unlock_exit_code}" -eq "${LOCK_FAILURE_EXIT_CODE}" ]; then
            echo "SST deploy is still locked after auto-unlock attempt."
          else
            echo "SST deploy failed after auto-unlock with non-lock error (exit code: ${post_unlock_exit_code})."
          fi
        fi
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
