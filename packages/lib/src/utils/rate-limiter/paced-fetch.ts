// packages/lib/src/utils/rate-limiter/paced-fetch.ts
// The thin composition providers call: reserve a slot on the shared cursor, fetch,
// and on a throttle publish the `Retry-After` back onto that same cursor before
// retrying. Everything interesting lives in `pacer.ts`; this is the two-line loop
// that stops each new provider from arriving with its own private pacing code.

import { acquireSlot, reportRetryAfter } from './pacer'
import type { Quota } from './quota'

/** Attempts after the first before the last response is handed back as-is. */
const DEFAULT_MAX_RETRIES = 3

/** Assumed backoff when a throttling response carries no usable `Retry-After`. */
const DEFAULT_RETRY_AFTER_MS = 1_000

export interface PacedFetchOptions {
  /** Retries after the first attempt. Default 3. */
  maxRetries?: number
  /** Quota units this call consumes. Default 1. */
  cost?: number
  /** Aborts pacing sleeps (the `fetch` itself takes its own signal via `init`). */
  signal?: AbortSignal
  /** Statuses treated as throttling. Default `[429]`. */
  throttleStatuses?: number[]
  /** Observability hook, fired once per throttled attempt before the retry. */
  onThrottle?: (info: { attempt: number; status: number; retryAfterMs: number }) => void
}

export interface PacedFetchResult {
  response: Response
  /** Wall-clock slept on pacing across every attempt. */
  waitedMs: number
  /** Attempts made, including the one that produced `response`. */
  attempts: number
}

/**
 * Parse a `Retry-After` header (delta-seconds or HTTP-date) to milliseconds.
 * `undefined` when absent or unparseable.
 */
export function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000)
  const when = Date.parse(value)
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now())
  return undefined
}

/**
 * Issue a request paced against a shared {@link Quota}.
 *
 * On a throttling status the observed `Retry-After` is pushed onto the shared cursor
 * and the loop simply retries — it deliberately does NOT sleep here, because the next
 * `acquireSlot` already reserves a slot past the retry point. Sleeping as well would
 * double-wait, and the shared push is what makes one process's 429 delay every OTHER
 * process too.
 *
 * The final response is returned regardless of status once retries are exhausted;
 * callers own their own error mapping.
 *
 * @throws {import('../../errors').RateLimitError} When the reservation lands past the
 *   quota's burst ceiling — i.e. the backlog is longer than the caller agreed to wait.
 */
export async function pacedFetch(
  quota: Quota,
  input: string | URL,
  init: RequestInit = {},
  options: PacedFetchOptions = {}
): Promise<PacedFetchResult> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const throttleStatuses = options.throttleStatuses ?? [429]
  let waitedMs = 0

  for (let attempt = 0; ; attempt++) {
    waitedMs += await acquireSlot(quota, { cost: options.cost, signal: options.signal })

    const response = await fetch(input, init)

    if (throttleStatuses.includes(response.status) && attempt < maxRetries) {
      const retryAfterMs =
        parseRetryAfterMs(response.headers.get('retry-after')) ?? DEFAULT_RETRY_AFTER_MS
      options.onThrottle?.({ attempt, status: response.status, retryAfterMs })
      await reportRetryAfter(quota, retryAfterMs)
      continue
    }

    return { response, waitedMs, attempts: attempt + 1 }
  }
}
