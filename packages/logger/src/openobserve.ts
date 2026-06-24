// packages/logger/src/openobserve.ts

import { type LogRecord, registerLogSink } from './index'

/**
 * Ships structured log records to a local OpenObserve instance over HTTP.
 *
 * Dev-focused and on by default: `pnpm dev` starts the `openobserve` container
 * (docker-compose), so outside production the sink defaults to the local
 * instance at http://localhost:5080. Override the target with `OPENOBSERVE_URL`,
 * or turn it off entirely with `OPENOBSERVE_DISABLE=true`. In production the sink
 * stays inactive unless `OPENOBSERVE_URL` is set explicitly.
 *
 * Import this module once per long-running process (worker, api, web bootstrap)
 * for its side effect of registering the sink. Records are batched and flushed
 * on a short interval so logging stays non-blocking; failures are swallowed so a
 * missing/down collector never affects the app.
 */

const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const DISABLED =
  process.env.OPENOBSERVE_DISABLE === 'true' || process.env.OPENOBSERVE_DISABLE === '1'

// Explicit URL always wins; otherwise default to the local container in dev.
const RESOLVED_URL = DISABLED
  ? undefined
  : (process.env.OPENOBSERVE_URL ?? (IS_PRODUCTION ? undefined : 'http://localhost:5080'))

const BASE_URL = RESOLVED_URL?.replace(/\/$/, '')
const ORG = process.env.OPENOBSERVE_ORG ?? 'default'
const STREAM = process.env.OPENOBSERVE_STREAM ?? 'auxx'
// Defaults mirror the docker-compose `openobserve` service root credentials.
const EMAIL = process.env.OPENOBSERVE_EMAIL ?? 'root@auxx.dev'
const PASSWORD = process.env.OPENOBSERVE_PASSWORD ?? 'Complexpass#123'
const APP =
  process.env.APP_NAME ?? process.env.SERVICE_NAME ?? process.env.npm_package_name ?? 'app'

const MAX_BATCH = 100
const FLUSH_MS = 2000

if (BASE_URL) {
  const endpoint = `${BASE_URL}/api/${ORG}/${STREAM}/_json`
  const auth = `Basic ${Buffer.from(`${EMAIL}:${PASSWORD}`).toString('base64')}`

  const queue: Record<string, unknown>[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let flushing = false

  const flush = async (): Promise<void> => {
    if (flushing || queue.length === 0) return
    flushing = true
    const batch = queue.splice(0, queue.length)
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify(batch),
      })
    } catch {
      // Dev-only sink: drop the batch rather than crash or block on a down collector.
    } finally {
      flushing = false
    }
  }

  const schedule = (): void => {
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      void flush()
    }, FLUSH_MS)
    // Don't keep the event loop alive just to flush logs.
    timer.unref?.()
  }

  registerLogSink((_formatted: string, record: LogRecord) => {
    queue.push({
      // OpenObserve reads the entry time from `_timestamp` (microseconds since epoch).
      _timestamp: new Date(record.time).getTime() * 1000,
      level: record.level,
      scope: record.scope,
      app: APP,
      message: record.message,
      ...record.fields,
      ...(record.args.length > 0 ? { args: record.args } : {}),
    })
    if (queue.length >= MAX_BATCH) void flush()
    else schedule()
  })

  // Best-effort final flush so the last lines before exit aren't lost.
  process.once('beforeExit', () => void flush())
}
