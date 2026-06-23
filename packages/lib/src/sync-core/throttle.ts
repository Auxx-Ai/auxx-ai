// packages/lib/src/sync-core/throttle.ts
// Adapter from the shared `UniversalThrottler` to the core's `ThrottleHandle` seam.
// The core hands a handle to each `fetchSlice`; the source runs every upstream call
// through it. Keying is `connection:operation` (shared-sync-core-plan §3.3) so two
// sources on the same upstream account share one rate budget, while distinct API
// method quotas (e.g. gmail sync vs batch) stay separated.

import type { UniversalThrottler } from '../utils/rate-limiter'
import type { ThrottleHandle } from './contracts'

/**
 * Wrap a `UniversalThrottler` as a `ThrottleHandle` bound to one throttle key.
 * `throttleKey` is the source's `${connectionId}:${operation}` bucket. The handle
 * is per-slice but the underlying throttler (and its Redis-backed token bucket +
 * circuit breaker + cross-run `Retry-After` backoff) is shared process-wide.
 */
export function createThrottleHandle(
  throttler: UniversalThrottler,
  throttleKey: string
): ThrottleHandle {
  return {
    run: (fn) => throttler.execute(throttleKey, fn),
  }
}
