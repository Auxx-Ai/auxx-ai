# apps/echtzeit/Dockerfile
# Self-hosted realtime transport — Sockudo, a Rust, Pusher-protocol-compatible
# WebSocket server (https://sockudo.io). This is the prod/Railway artifact; it
# pins the SAME image tag the local docker-compose `echtzeit` service uses, so
# dev and prod run byte-identical binaries.
#
# Config is env-driven (see railway.json / docker-compose / .env.example) — no
# config file is copied in. Every cap and toggle we need maps to a documented
# Sockudo env var (SOCKUDO_DEFAULT_APP_*, WEBSOCKET_MAX_PAYLOAD_KB, METRICS_*),
# so a hand-written config file would only add schema drift.

FROM ghcr.io/sockudo/sockudo:4.6.0

# App credentials MUST match the app services' PUSHER_APP_ID/KEY/SECRET, or every
# HMAC channel-auth signature fails. On Railway these come from the service env;
# the values below are only sane local/build defaults.
ENV HOST=0.0.0.0 \
    PORT=6001 \
    METRICS_ENABLED=true \
    METRICS_HOST=0.0.0.0 \
    METRICS_PORT=9601 \
    APP_MANAGER_DRIVER=memory \
    SSL_ENABLED=false \
    HTTP_API_USAGE_ENABLED=false \
    SOCKUDO_DEFAULT_APP_ENABLED=true \
    SOCKUDO_DEFAULT_APP_ENABLE_CLIENT_MESSAGES=false \
    SOCKUDO_DEFAULT_APP_ALLOWED_ORIGINS= \
    WEBSOCKET_MAX_PAYLOAD_KB=100 \
    SOCKUDO_DEFAULT_APP_MAX_EVENT_PAYLOAD_IN_KB=100 \
    SOCKUDO_DEFAULT_APP_MAX_EVENT_BATCH_SIZE=10 \
    HEALTHCHECK_PATH=up

# 6001 = WebSocket + signed HTTP API (Pusher protocol). 9601 = Prometheus metrics.
EXPOSE 6001 9601

# Global health probe (no app-id coupling, no dependency checks).
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/up" || exit 1
