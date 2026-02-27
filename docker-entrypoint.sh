#!/bin/sh
# docker-entrypoint.sh
# Replaces build-time URL placeholders with runtime values in .next client bundles.
#
# At build time, DOMAIN=__RUNTIME_DOMAIN__ is baked into Next.js bundles.
# url.ts produces these patterns:
#   https://app.__RUNTIME_DOMAIN__    (WEBAPP_URL)
#   https://api.__RUNTIME_DOMAIN__    (API_URL)
#   https://__RUNTIME_DOMAIN__        (HOMEPAGE_URL)
#   https://docs.__RUNTIME_DOMAIN__   (DOCS_URL)
#   https://build.__RUNTIME_DOMAIN__  (DEV_PORTAL_URL)
#
# Supports two replacement modes:
#   1. Explicit URL overrides — for platforms like Railway where each service
#      has its own domain (no shared root).
#   2. DOMAIN-based replacement — for custom domains with subdomain patterns.
#
# Order matters: specific URL patterns (with subdomain prefix) are replaced
# first, then HOMEPAGE_URL (bare https://PLACEHOLDER), then DOMAIN catches
# any remaining occurrences.

PLACEHOLDER="__RUNTIME_DOMAIN__"
NEXT_DIR="/app/.next"

replace_in_next() {
  local pattern="$1"
  local replacement="$2"
  local label="$3"

  echo "[entrypoint] Replacing '${label}' → ${replacement}"
  find "${NEXT_DIR}" -name '*.js' -type f -exec sed -i \
    -e "s|${pattern}|${replacement}|g" \
    {} + 2>/dev/null || true
}

if [ ! -d "${NEXT_DIR}" ]; then
  echo "[entrypoint] No .next directory found — skipping replacements."
  exec "$@"
fi

replaced=false

# Step 1: Replace subdomain URL patterns with explicit overrides.
# These must run before HOMEPAGE_URL (which matches the bare https://PLACEHOLDER).
if [ -n "${APP_URL}" ]; then
  replace_in_next "https://app.${PLACEHOLDER}" "${APP_URL}" "https://app.${PLACEHOLDER}"
  replaced=true
fi

if [ -n "${API_URL}" ]; then
  replace_in_next "https://api.${PLACEHOLDER}" "${API_URL}" "https://api.${PLACEHOLDER}"
  replaced=true
fi

if [ -n "${DOCS_URL}" ]; then
  replace_in_next "https://docs.${PLACEHOLDER}" "${DOCS_URL}" "https://docs.${PLACEHOLDER}"
  replaced=true
fi

if [ -n "${DEV_PORTAL_URL}" ]; then
  replace_in_next "https://build.${PLACEHOLDER}" "${DEV_PORTAL_URL}" "https://build.${PLACEHOLDER}"
  replaced=true
fi

# Step 2: Replace bare https://PLACEHOLDER (HOMEPAGE_URL — no subdomain).
# Must run after subdomain replacements to avoid partial matches.
if [ -n "${HOMEPAGE_URL}" ]; then
  replace_in_next "https://${PLACEHOLDER}" "${HOMEPAGE_URL}" "https://${PLACEHOLDER}"
  replaced=true
fi

# Step 3: Replace any remaining bare PLACEHOLDER occurrences with DOMAIN.
# Catches anything not covered by explicit overrides above.
if [ -n "${DOMAIN}" ] && [ "${DOMAIN}" != "${PLACEHOLDER}" ]; then
  replace_in_next "${PLACEHOLDER}" "${DOMAIN}" "${PLACEHOLDER}"
  replaced=true
fi

if [ "${replaced}" = true ]; then
  echo "[entrypoint] Replacement complete."
else
  echo "[entrypoint] No replacements needed (DOMAIN=${DOMAIN:-<unset>}, APP_URL=${APP_URL:-<unset>})."
fi

exec "$@"
