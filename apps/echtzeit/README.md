# apps/echtzeit — self-hosted realtime transport (Sockudo)

`echtzeit` (German for "realtime") runs [Sockudo](https://sockudo.io), an
actively-maintained, open-source, **Pusher-protocol-compatible** WebSocket server
written in Rust. It replaces the hosted Pusher cloud as our realtime transport.

Because Sockudo speaks the Pusher protocol (Protocol V1), the existing `pusher`
(server) and `pusher-js` (client) libraries keep working unchanged — we only
repoint host/port. There is **no new provider/adapter class**; the seam in
`docs/realtime-architecture-guide.md` is untouched. Unset `PUSHER_HOST` to fall
back to the hosted Pusher cloud.

This app is **config-only**: there is no `package.json` or `node_modules`.
Sockudo ships as the `ghcr.io/sockudo/sockudo` Docker image; the `Dockerfile`
here is that image + our env defaults. With no `dev` script, `turbo dev` skips it
automatically — locally it runs as a Docker Compose service alongside
postgres/redis (see the root `docker-compose.yml`).

## Configuration is env-driven

We do **not** ship a Sockudo config file. Sockudo prefers TOML and falls back to
JSON, but every knob we need has a documented environment variable, so env-only
avoids config-schema drift across Sockudo versions.

| Env var                                       | Purpose                                                              |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `SOCKUDO_DEFAULT_APP_ID`                      | App id — **must equal** the app services' `PUSHER_APP_ID`            |
| `SOCKUDO_DEFAULT_APP_KEY`                     | App key — **must equal** `PUSHER_KEY`                                |
| `SOCKUDO_DEFAULT_APP_SECRET`                  | App secret — **must equal** `PUSHER_SECRET`                          |
| `SOCKUDO_DEFAULT_APP_ENABLE_CLIENT_MESSAGES`  | `false` — all events are server-mediated; we never use client events |
| `SOCKUDO_DEFAULT_APP_ALLOWED_ORIGINS`         | Empty = all origins allowed (parity with Pusher today). See below.   |
| `WEBSOCKET_MAX_PAYLOAD_KB`                    | Server frame cap (KiB). Raised to `100` for headroom.                |
| `SOCKUDO_DEFAULT_APP_MAX_EVENT_PAYLOAD_IN_KB` | Per-app event payload cap (KiB). Raised to `100`.                    |
| `APP_MANAGER_DRIVER`                          | `memory` — single default app, no DB needed                          |
| `SSL_ENABLED`                                 | `false` — Railway's edge terminates TLS                              |
| `HTTP_API_USAGE_ENABLED`                      | `false` — disable the unauthenticated `/usage` + `/stats` endpoints (on by default in the image) |
| `METRICS_ENABLED` / `METRICS_PORT`            | Prometheus metrics on `:9601` (`/metrics`)                           |

> **#1 footgun — app-creds parity.** `SOCKUDO_DEFAULT_APP_ID/KEY/SECRET` MUST be
> identical to `PUSHER_APP_ID/KEY/SECRET` on web/api/worker, or every HMAC
> channel-auth signature fails. Locally, both the compose service and the host
> apps read the same `PUSHER_*` from the root `.env`, so they stay in sync.

## Ports & health

- `6001` — WebSocket upgrades + the signed HTTP publish API (Pusher protocol).
- `9601` — Prometheus metrics (`/metrics`). Keep this port private.
- Health probes (no auth, no app-id coupling):
  - `GET /up` — global health probe (used by the container healthcheck + Railway).
  - `GET /live` — liveness only, no dependency checks.
- `GET /usage` + `GET /stats` are unauthenticated ops endpoints that are **on by
  default** in the image and leak host memory/occupancy. We disable them with
  `HTTP_API_USAGE_ENABLED=false` so they return 404 on the public domain.

## Local development

Nothing to run by hand — `pnpm dev` does `docker compose up -d --wait`, which
starts `echtzeit` next to postgres/redis/openobserve and blocks on its
healthcheck. Apps reach it over **plain ws** at `ws://127.0.0.1:6001` because the
local `.env` sets `PUSHER_HOST=127.0.0.1`, `PUSHER_PORT=6001`,
`PUSHER_USE_TLS=false`.

Smoke-test it with any `pusher-js` client pointed at `ws://127.0.0.1:6001` using
the local `PUSHER_KEY`. Two Sockudo-specific checks worth running once:

1. `pusher.trigger(channel, event, data, { socket_id })` excludes the originating
   socket (echo-suppression depends on this).
2. A `trigger` with a >64 KB payload arrives intact (confirms the raised caps).

## Railway (production)

Deploy the echtzeit service from the public image (`ghcr.io/sockudo/sockudo:4.6.0`)
or this `Dockerfile`. Railway terminates TLS at its edge → container port. Set a
public domain `echtzeit.<env>.auxx.ai`, enable WebSockets, health-check path `/up`.

### Env vars on the **echtzeit** service

```
SOCKUDO_DEFAULT_APP_ID=${{shared.PUSHER_APP_ID}}      # must equal the apps' PUSHER_APP_ID
SOCKUDO_DEFAULT_APP_KEY=${{shared.PUSHER_KEY}}        # must equal the apps' PUSHER_KEY
SOCKUDO_DEFAULT_APP_SECRET=${{shared.PUSHER_SECRET}}  # must equal the apps' PUSHER_SECRET
SOCKUDO_DEFAULT_APP_ENABLED=true
SOCKUDO_DEFAULT_APP_ENABLE_CLIENT_MESSAGES=false
SOCKUDO_DEFAULT_APP_ALLOWED_ORIGINS=
WEBSOCKET_MAX_PAYLOAD_KB=100
SOCKUDO_DEFAULT_APP_MAX_EVENT_PAYLOAD_IN_KB=100
APP_MANAGER_DRIVER=memory
SSL_ENABLED=false
HTTP_API_USAGE_ENABLED=false
PORT=6001        # pin it; Railway otherwise injects its own PORT and the domain target won't match
```

### Env vars on the **app services (web, api, worker)**

These are what point the `pusher`/`pusher-js` clients (and the widget) at Sockudo
instead of Pusher cloud. Set them on every app that publishes or subscribes —
**web, api, worker** (the satellite apps load root env, but set them explicitly /
as shared vars to be safe):

```
PUSHER_HOST=echtzeit.<env>.auxx.ai   # e.g. echtzeit.auxx.ai (prod). Empty → hosted Pusher cloud fallback.
PUSHER_PORT=443                      # Railway wss edge
PUSHER_USE_TLS=true                  # connect over wss
PUSHER_APP_ID=${{shared.PUSHER_APP_ID}}
PUSHER_KEY=${{shared.PUSHER_KEY}}
PUSHER_SECRET=${{shared.PUSHER_SECRET}}
# PUSHER_CLUSTER is only read when PUSHER_HOST is empty (cloud fallback).
```

> **Parity is the #1 footgun.** `SOCKUDO_DEFAULT_APP_ID/KEY/SECRET` on echtzeit
> MUST equal `PUSHER_APP_ID/KEY/SECRET` on web/api/worker, or every private/presence
> channel-auth HMAC signature fails (the transport stays healthy but no private
> subscription succeeds). Using Railway `${{shared.PUSHER_*}}` everywhere makes this
> automatic. `PUSHER_SECRET` stays secret — it's the HMAC key; `PUSHER_KEY`/`_APP_ID`
> are semi-public (the key ships to the browser).

Local dev uses the same names with `PUSHER_HOST=127.0.0.1`, `PUSHER_PORT=6001`,
`PUSHER_USE_TLS=false` (see the root `.env` / `.env.example`).

## Allowed origins

`SOCKUDO_DEFAULT_APP_ALLOWED_ORIGINS` is left **empty** (= all origins allowed),
matching Pusher's current behavior. The admin app and the embeddable chat widget
share one Sockudo app, and the widget lives on arbitrary customer domains, so a
restrictive list can't be used without first splitting the widget onto its own
app (a documented fast-follow, not v1). The list only gates the browser WS
upgrade — server publishes via `POST /apps/{id}/events` are server-to-server and
unaffected.

> Sharp edge if a list is ever set: a non-matching origin gets `pusher:error`
> code `4009`, which is in Pusher's do-not-reconnect band (4000–4099) — a
> **permanent silent failure**, not a visible retry loop. Patterns are exact:
> port matters (`localhost:3000`), scheme matters (`https://`), and `*.d.com`
> does **not** match the root `d.com`.

## High availability

```
ADAPTER_DRIVER=redis
REDIS_URL=redis://<host>:<port>
```

Then scale replicas. Redis pub/sub carries cross-instance fanout. Wire this only
when load demands it.
