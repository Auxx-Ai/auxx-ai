#!/bin/sh
# docker-entrypoint.sh
# Replaces build-time URL placeholders with runtime values.
# Uses DOMAIN-based placeholders only.

replace_domain() {
  local placeholder="__RUNTIME_DOMAIN__"
  local value="$(printenv DOMAIN 2>/dev/null || true)"

  if [ -n "$value" ] && [ "$value" != "$placeholder" ]; then
    echo "[entrypoint] Replacing ${placeholder} with ${value} in .next assets..."
    find /app -path '*/.next/*' -name '*.js' -type f -exec sed -i \
      -e "s|${placeholder}|${value}|g" \
      {} + 2>/dev/null || true
    echo "[entrypoint] Domain replacement complete."
  else
    echo "[entrypoint] No DOMAIN replacement needed (DOMAIN=${value:-<unset>})."
  fi
}

replace_domain

exec "$@"
