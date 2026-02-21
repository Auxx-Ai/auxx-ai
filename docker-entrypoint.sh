#!/bin/sh
# docker-entrypoint.sh
# Replaces build-time NEXT_PUBLIC_* placeholders with runtime values.
# Only needed for Group A URL vars — all other config delivered via SSR dehydration.

replace_env() {
  local placeholder="__RUNTIME_${1}__"
  local value="$(printenv "$1" 2>/dev/null || true)"

  if [ -n "$value" ] && [ "$value" != "$placeholder" ]; then
    find /app/.next -name '*.js' -exec sed -i \
      -e "s|https://${placeholder}|${value}|g" \
      -e "s|${placeholder}|${value}|g" \
      {} +
  fi
}

replace_env NEXT_PUBLIC_BASE_URL
replace_env NEXT_PUBLIC_APP_URL
replace_env NEXT_PUBLIC_HOMEPAGE_URL
replace_env NEXT_PUBLIC_API_URL
replace_env NEXT_PUBLIC_DEV_PORTAL_URL
replace_env NEXT_PUBLIC_DOCS_URL

exec "$@"
