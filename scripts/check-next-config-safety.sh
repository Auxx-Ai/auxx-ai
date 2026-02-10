#!/usr/bin/env bash

# scripts/check-next-config-safety.sh
set -euo pipefail

if ! command -v rg >/dev/null 2>&1; then
  echo "Error: ripgrep (rg) is required for this check."
  exit 1
fi

if ! rg --files -g '**/next.config.*' . >/dev/null; then
  echo "No next.config.* files found; check passed."
  exit 0
fi

readonly BANNED_IMPORTS_REGEX="^\\s*import(?:\\s+type)?(?:[\\s\\w{},*]+from\\s+)?['\\\"](?:@auxx/config/client|@auxx/config/server|@auxx/config|dotenv(?:/config)?)['\\\"]|require\\(\\s*['\\\"](?:@auxx/config/client|@auxx/config/server|@auxx/config|dotenv(?:/config)?)['\\\"]\\s*\\)"

matches="$(rg -n --no-heading --pcre2 -g '**/next.config.*' "${BANNED_IMPORTS_REGEX}" . || true)"

if [ -n "${matches}" ]; then
  echo "Unsafe imports found in next.config.* files:"
  echo "${matches}"
  exit 1
fi

echo "next.config.* safety check passed."
