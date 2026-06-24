# Log history (OpenObserve)

`@auxx/logger` writes to the console for live debugging. To **review and search
older logs** in a browser, we ship the same structured records to a local
[OpenObserve](https://openobserve.ai) instance.

This is a **dev-only** setup that's **on by default** — it works the same way
postgres and redis do. `pnpm dev` runs `docker compose up -d`, which starts the
`openobserve` container alongside the rest of the stack, and the apps ship logs
to it automatically in development.

## Usage

1. `pnpm dev` (from the repo root) — starts the collector and apps. Make sure
   the `OPENOBSERVE_*` block from `.env.example` is present in your `.env`.

2. Open the UI: **http://localhost:5080** → _Logs_ → stream `auxx`. Log in with
   `OPENOBSERVE_EMAIL` / `OPENOBSERVE_PASSWORD` (defaults
   `root@auxx.dev` / `Complexpass#123`).

Logs from `web`, `worker`, and `api` all flow into the `auxx` stream, tagged by
`app`.

### Turning it off

Set `OPENOBSERVE_DISABLE=true` in your `.env` to stop shipping logs (the console
output is unchanged). The container still starts with `pnpm dev`; run
`docker compose stop openobserve` if you don't want it running at all.

In **production** the sink stays inactive unless `OPENOBSERVE_URL` is set
explicitly.

## Searching

Each entry is structured, so you can filter instead of grepping:

- `level='error'`
- `scope='billing'`
- `app='@auxx/worker'`
- free-text match on `message`
- any field added via `logger.with({ ... })` becomes a queryable column
- time-range picker for "what happened recently"

## How it works

- `packages/logger/src/index.ts` emits a structured `LogRecord`
  (`time`, `level`, `scope`, `message`, `args`, `fields`) to every registered
  sink, in addition to the console line.
- `packages/logger/src/openobserve.ts` is a side-effect module that registers an
  HTTP sink. Outside production it defaults to `http://localhost:5080`
  (override with `OPENOBSERVE_URL`, disable with `OPENOBSERVE_DISABLE=true`). It
  batches records and POSTs them to OpenObserve's ingest endpoint; failures are
  swallowed so a down collector never affects the app.
- The long-running processes import it once at startup:
  `apps/worker/src/server.ts`, `apps/api/src/index.ts`, and
  `apps/web/src/server/bootstrap.ts`.

Sensitive fields (password/secret/token/apikey) are already redacted by the
logger's `sanitizeLogValue` before they reach any sink.
