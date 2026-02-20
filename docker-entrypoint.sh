#!/bin/sh
# docker-entrypoint.sh
# Replaces build-time NEXT_PUBLIC_* placeholders with runtime env var values.
# Used by apps/web and apps/build Docker images.

replace_env() {
  local placeholder="__RUNTIME_${1}__"
  local value="$(printenv "$1" 2>/dev/null || true)"

  if [ -n "$value" ] && [ "$value" != "$placeholder" ]; then
    # Replace both "https://__RUNTIME_*__" (URL placeholders) and bare "__RUNTIME_*__"
    find /app/.next -name '*.js' -exec sed -i \
      -e "s|https://${placeholder}|${value}|g" \
      -e "s|${placeholder}|${value}|g" \
      {} +
  fi
}

replace_env NEXT_PUBLIC_BASE_URL
replace_env NEXT_PUBLIC_APP_URL
replace_env NEXT_PUBLIC_API_URL
replace_env NEXT_PUBLIC_DEV_PORTAL_URL
replace_env NEXT_PUBLIC_HOMEPAGE_URL
replace_env NEXT_PUBLIC_CDN_URL
replace_env NEXT_PUBLIC_S3_PUBLIC_BUCKET
replace_env NEXT_PUBLIC_S3_PRIVATE_BUCKET
replace_env NEXT_PUBLIC_S3_REGION
replace_env NEXT_PUBLIC_STORAGE_TYPE
replace_env NEXT_PUBLIC_ENV
replace_env NEXT_PUBLIC_PUSHER_KEY
replace_env NEXT_PUBLIC_PUSHER_CLUSTER

exec "$@"
