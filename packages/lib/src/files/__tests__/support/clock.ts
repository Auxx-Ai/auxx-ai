// packages/lib/src/files/__tests__/support/clock.ts

/**
 * A deterministic `() => Date` for {@link FilesDeps.now}.
 *
 * `deriveStorageKey` puts `Date.now()` straight into the storage key and every
 * `expiresAt` is computed from it, so asserting on either meant `vi.useFakeTimers()`
 * — which is process-global and leaks into anything else the test touches. A
 * clock passed as a parameter has neither problem, and `advance` lets a test
 * step across a TTL boundary explicitly instead of sleeping.
 */

/** The default instant, chosen to be obviously fake in a failure diff. */
export const DEFAULT_TEST_INSTANT = '2026-01-01T00:00:00.000Z'

export interface FakeClock {
  /** Pass this as `FilesDeps.now`. Returns a fresh `Date` each call, never a shared one. */
  now: () => Date
  /** Move the clock forward (or back, with a negative value) by milliseconds. */
  advance(ms: number): void
  /** Jump to an absolute instant. */
  set(iso: string): void
  /** The current instant in milliseconds, for building expected values. */
  millis(): number
}

/** Build a clock frozen at `iso` until a test advances it. */
export function makeClock(iso: string = DEFAULT_TEST_INSTANT): FakeClock {
  let millis = new Date(iso).getTime()
  if (Number.isNaN(millis)) {
    throw new Error(`makeClock received an unparseable instant: ${iso}`)
  }

  return {
    now: () => new Date(millis),
    advance: (ms) => {
      millis += ms
    },
    set: (next) => {
      const parsed = new Date(next).getTime()
      if (Number.isNaN(parsed)) {
        throw new Error(`makeClock().set received an unparseable instant: ${next}`)
      }
      millis = parsed
    },
    millis: () => millis,
  }
}
