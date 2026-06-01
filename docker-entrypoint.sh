#!/bin/sh
# docker-entrypoint.sh
#
# Shared entrypoint for every app image in the monorepo. Each block is
# independently gated by its own preconditions, so the same script no-ops
# safely in containers that don't need it.
#
# Block 1 — Next.js runtime URL substitution (web, homepage, docs, build):
#   At build time DOMAIN=__RUNTIME_DOMAIN__ is baked into Next.js bundles.
#   url.ts produces these patterns:
#     https://app.__RUNTIME_DOMAIN__    (WEBAPP_URL)
#     https://api.__RUNTIME_DOMAIN__    (API_URL)
#     https://__RUNTIME_DOMAIN__        (HOMEPAGE_URL)
#     https://docs.__RUNTIME_DOMAIN__   (DOCS_URL)
#     https://build.__RUNTIME_DOMAIN__  (DEV_PORTAL_URL)
#   Two replacement modes are supported:
#     1. Explicit URL overrides — for platforms like Railway where each
#        service has its own domain (no shared root).
#     2. DOMAIN-based replacement — for custom domains with subdomain
#        patterns.
#   Order matters: specific URL patterns (with subdomain prefix) are
#   replaced first, then HOMEPAGE_URL (bare https://PLACEHOLDER), then
#   DOMAIN catches any remaining occurrences.
#
# Block 2 — Optional MaxMind GeoLite2-City download (api):
#   When AUXX_GEO_PROVIDER=maxmind (default) and MAXMIND_LICENSE_KEY is
#   set, fetch the mmdb on first boot so the chat widget can label
#   visitors with their city. License terms forbid redistribution, so
#   the db is NEVER baked into the published image — operators always
#   bring their own key. Persists when /app/geo is a mounted volume.

PLACEHOLDER="__RUNTIME_DOMAIN__"
PLACEHOLDER_LOWER="__runtime_domain__"
# Resolve relative to WORKDIR (set by each app's Dockerfile to /app/apps/<app>/)
NEXT_DIR="$(pwd)/.next"

replace_in_next() {
  local pattern="$1"
  local replacement="$2"
  local label="$3"

  # Derive lowercase variant of the pattern (turbopack may lowercase env values)
  local pattern_lower
  pattern_lower=$(echo "${pattern}" | tr '[:upper:]' '[:lower:]')

  echo "[entrypoint] Replacing '${label}' → ${replacement}"
  find "${NEXT_DIR}" \( -name '*.js' -o -name '*.rsc' -o -name '*.html' -o -name '*.body' \) -type f -exec sed -i \
    -e "s|${pattern}|${replacement}|g" \
    -e "s|${pattern_lower}|${replacement}|g" \
    {} + 2>/dev/null || true
}

# Block 1 only applies to Next.js images (web/homepage/docs/build). Non-Next
# images (api, worker) have no .next dir — skip the URL replacements but FALL
# THROUGH to Block 2 (geo) and the privilege drop below. (This previously
# `exec`-ed here, which silently skipped the geo download in the api image.)
if [ -d "${NEXT_DIR}" ]; then

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

else
  echo "[entrypoint] No .next directory found — skipping URL replacements."
fi

# ─────────────────────────────────────────────────────────────────────
# Block 2 — Optional GeoLite2-City download
# ─────────────────────────────────────────────────────────────────────
GEO_FILE="${MAXMIND_DB_PATH:-/app/geo/GeoLite2-City.mmdb}"
GEO_DIR="${GEO_FILE%/*}"
GEO_PROVIDER="${AUXX_GEO_PROVIDER:-maxmind}"

if [ "${GEO_PROVIDER}" != "maxmind" ]; then
  echo "[geo] AUXX_GEO_PROVIDER=${GEO_PROVIDER} — skipping MaxMind download"
elif [ -f "${GEO_FILE}" ]; then
  echo "[geo] ${GEO_FILE} exists — skipping download"
elif [ -z "${MAXMIND_LICENSE_KEY}" ]; then
  echo "[geo] MAXMIND_LICENSE_KEY not set — geo lookups will be disabled"
  echo "[geo] To enable: sign up at maxmind.com and generate a GeoLite2 license key"
else
  mkdir -p "${GEO_DIR}"
  echo "[geo] downloading GeoLite2-City…"
  if command -v curl >/dev/null 2>&1 && curl -sSL --fail --max-time 60 \
       "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${MAXMIND_LICENSE_KEY}&suffix=tar.gz" \
       -o /tmp/geolite2.tar.gz; then
    if tar -xzf /tmp/geolite2.tar.gz -C /tmp 2>/dev/null; then
      mmdb=$(find /tmp -maxdepth 3 -name 'GeoLite2-City.mmdb' -print -quit)
      if [ -n "${mmdb}" ]; then
        if mv "${mmdb}" "${GEO_FILE}"; then
          rm -rf /tmp/geolite2.tar.gz /tmp/GeoLite2-City_*
          echo "[geo] installed at ${GEO_FILE}"
        else
          echo "[geo] failed to write ${GEO_FILE} — geo lookups will be disabled"
          rm -f /tmp/geolite2.tar.gz
        fi
      else
        echo "[geo] mmdb not found inside archive — geo lookups will be disabled"
        rm -f /tmp/geolite2.tar.gz
      fi
    else
      echo "[geo] tar extract failed — geo lookups will be disabled"
      rm -f /tmp/geolite2.tar.gz
    fi
  else
    echo "[geo] download failed — geo lookups will be disabled"
  fi
fi

# ─────────────────────────────────────────────────────────────────────
# Drop root → app user before exec'ing the app.
# ─────────────────────────────────────────────────────────────────────
# Railway mounts volumes owned by root, and a non-root image can't write to
# the mount — so the api service sets RAILWAY_RUN_UID=0 to let the geo block
# above download into /app/geo. The app itself must NOT run as root, so we
# hand the geo dir to the app user and drop privileges here.
#
# Generic across every image: we drop to whoever owns /app (each image chowns
# its files to its own app user). Images that already start non-root never
# enter this branch, so it's a no-op for them.
if [ "$(id -u)" = "0" ] && command -v gosu >/dev/null 2>&1; then
  app_uid=$(stat -c '%u' /app 2>/dev/null || echo 0)
  if [ "${app_uid}" != "0" ]; then
    chown -R "${app_uid}" "${GEO_DIR}" 2>/dev/null || true
    exec gosu "${app_uid}" "$@"
  fi
fi

exec "$@"
