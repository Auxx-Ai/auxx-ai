#!/usr/bin/env bash

# scripts/check-next-config-safety.sh
set -euo pipefail

# Find next.config.* files
NEXT_CONFIGS=$(find . -name 'next.config.*' -not -path '*/node_modules/*' -not -path '*/.next/*' -not -path '*/.sst/*')

if [ -z "${NEXT_CONFIGS}" ]; then
  echo "No next.config.* files found; check passed."
  exit 0
fi

readonly BANNED_IMPORTS_REGEX="^\s*import(\s+type)?([\s\w{},*]+from\s+)?['\"](@auxx/config(/client|/server)?|dotenv(/config)?)['\"]|require\(\s*['\"](@auxx/config(/client|/server)?|dotenv(/config)?)['\"]"

matches="$(grep -rnP "${BANNED_IMPORTS_REGEX}" ${NEXT_CONFIGS} || true)"

if [ -n "${matches}" ]; then
  echo "Unsafe imports found in next.config.* files:"
  echo "${matches}"
  exit 1
fi

echo "next.config.* safety check passed."
