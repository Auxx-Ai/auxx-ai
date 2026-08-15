// packages/lib/src/sync-core/throttle.ts
// Adapter from the shared pacer to the core's `ThrottleHandle` seam. The core hands a
// handle to each `fetchSlice`; a source runs upstream work through it.
//
// What this delivers, precisely: ONE cost-weighted slot reservation on the quota's
// shared Redis cursor per `run()` call, slept until due, cross-process. Any 429 that
// another caller published via `reportRetryAfter` is already folded into that cursor,
// so the reservation lands past it.
//
// What it does NOT deliver, and never did despite the previous doc comment claiming
// otherwise: a token bucket, a circuit breaker, or a queue. Per-REQUEST pacing for the
// data-connector path lives in the HTTP transport (`connections/transports/http.ts`),
// which reserves on the same connection quota — a handle wrapping a whole slice is a
// far coarser unit than a page fetch.

import { acquireSlot } from '../utils/rate-limiter/pacer'
import type { Quota } from '../utils/rate-limiter/quota'
import type { ThrottleHandle } from './contracts'

/**
 * Wrap a shared {@link Quota} as a `ThrottleHandle`.
 *
 * @param quota - The metered budget this slice's work draws from. Two sources on one
 *   upstream account must resolve the same quota to share a budget.
 * @param opts.cost - Quota units one `run()` consumes. Default 1.
 * @param opts.signal - Cancels the pacing sleep, so an aborted slice never parks.
 * @throws {import('../errors').RateLimitError} From `run()` when the backlog exceeds
 *   the quota's burst ceiling — the caller should yield the slice, not spin.
 */
export function createThrottleHandle(
  quota: Quota,
  opts: { cost?: number; signal?: AbortSignal } = {}
): ThrottleHandle {
  return {
    run: async (fn) => {
      await acquireSlot(quota, opts)
      return fn()
    },
  }
}
