#!/bin/sh
# docker-entrypoint.sh
# Replaces build-time URL placeholders with runtime values.
# Uses DOMAIN-based placeholders only.

replace_domain() {
  local placeholder="__RUNTIME_DOMAIN__"
  local value="$(printenv DOMAIN 2>/dev/null || true)"

  if [ -n "$value" ] && [ "$value" != "$placeholder" ]; then
    find /app -path '*/.next/*' -name '*.js' -exec sed -i \
      -e "s|${placeholder}|${value}|g" \
      {} +
  fi
}

replace_domain

exec "$@"
