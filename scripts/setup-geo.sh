#!/bin/sh
# scripts/setup-geo.sh
#
# Local-dev convenience for downloading the MaxMind GeoLite2-City database.
#
# In production / Docker, `docker-entrypoint.sh` does the equivalent on
# container start. Locally the API runs outside Docker (`pnpm dev`), so
# this script lets you pull the same db once and point the API at it via
# MAXMIND_DB_PATH in .env.
#
# Usage:
#   1. Sign up at https://www.maxmind.com (free GeoLite2 tier).
#   2. Generate a license key in your account dashboard.
#   3. Add to your .env:
#        MAXMIND_LICENSE_KEY=your_key_here
#        MAXMIND_DB_PATH=./apps/api/geo/GeoLite2-City.mmdb
#   4. Run: pnpm setup:geo
#
# License terms forbid redistribution — the db is gitignored and never
# committed.

set -e

# Pull MAXMIND_LICENSE_KEY / MAXMIND_DB_PATH out of .env if they aren't
# already exported. We grep specific keys instead of sourcing the whole
# file because .env contains multi-line values (RSA keys etc.) that don't
# parse as shell.
read_env() {
  key=$1
  [ -f .env ] || return 0
  line=$(grep -E "^${key}=" .env | head -n1 || true)
  [ -z "${line}" ] && return 0
  value=${line#*=}
  # strip surrounding single or double quotes
  case "${value}" in
    \"*\") value=${value%\"}; value=${value#\"} ;;
    \'*\') value=${value%\'}; value=${value#\'} ;;
  esac
  printf '%s' "${value}"
}

[ -z "${MAXMIND_LICENSE_KEY}" ] && MAXMIND_LICENSE_KEY=$(read_env MAXMIND_LICENSE_KEY)
[ -z "${MAXMIND_DB_PATH}" ] && MAXMIND_DB_PATH=$(read_env MAXMIND_DB_PATH)

GEO_FILE="${MAXMIND_DB_PATH:-./apps/api/geo/GeoLite2-City.mmdb}"
GEO_DIR="${GEO_FILE%/*}"

if [ -z "${MAXMIND_LICENSE_KEY}" ]; then
  echo "✗ MAXMIND_LICENSE_KEY not set."
  echo ""
  echo "  1. Sign up at https://www.maxmind.com"
  echo "  2. Generate a license key in your account dashboard"
  echo "  3. Add MAXMIND_LICENSE_KEY=<key> to .env"
  echo "  4. Re-run pnpm setup:geo"
  exit 1
fi

mkdir -p "${GEO_DIR}"

tmpdir=$(mktemp -d)
trap 'rm -rf "${tmpdir}"' EXIT

echo "→ Downloading GeoLite2-City…"
curl -sSL --fail --max-time 120 \
  "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${MAXMIND_LICENSE_KEY}&suffix=tar.gz" \
  -o "${tmpdir}/geolite2.tar.gz"

echo "→ Extracting…"
tar -xzf "${tmpdir}/geolite2.tar.gz" -C "${tmpdir}"

mmdb=$(find "${tmpdir}" -maxdepth 3 -name 'GeoLite2-City.mmdb' -print -quit)
if [ -z "${mmdb}" ]; then
  echo "✗ GeoLite2-City.mmdb not found inside the archive."
  exit 1
fi

mv "${mmdb}" "${GEO_FILE}"

size=$(ls -lh "${GEO_FILE}" | awk '{print $5}')
echo "✓ Installed ${GEO_FILE} (${size})"
echo ""
echo "  Set in your .env (only AUXX_GEO_PROVIDER needs to be set —"
echo "  MAXMIND_DB_PATH defaults to ./geo/GeoLite2-City.mmdb, which"
echo "  resolves correctly in both dev and Docker):"
echo "    AUXX_GEO_PROVIDER=maxmind"
echo ""
echo "  Restart the API to pick it up."
