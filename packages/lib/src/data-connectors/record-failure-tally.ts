// packages/lib/src/data-connectors/record-failure-tally.ts
// The circuit breaker behind per-record fault isolation.
//
// `sinkSourceRecord` catches a failing record, counts it, and moves on — so one bad
// row in a 4000-row crawl can no longer end the run. That alone is not resilience,
// though: a genuinely broken mapping (a misaligned column, a target field that no
// longer exists) fails EVERY record, and isolation on its own would turn that into a
// `partial` run that imported nothing, carrying thousands of identical errors and no
// legible cause. Bad DATA should degrade; a bad CONFIGURATION should stop, fast and
// loudly, naming what went wrong.
//
// This is the thing that tells them apart, and it is deliberately not a taxonomy of
// error types — those are unknowable across every provider and every field type. It
// reads the only signal that generalises: the failure RATE. If the database is gone,
// or the mapping is wrong, or the credential lost a scope, the shape is the same —
// nearly everything fails — and the tally trips within the first page.
//
// Pure and synchronous: no db, no clock, no I/O, so the thresholds are unit-testable.

/** How many failures in a row before the run is considered systemically broken. */
const CONSECUTIVE_LIMIT = 25

/**
 * Records that must be attempted before the RATE arm can fire. Below this a couple of
 * bad rows at the head of a page would look like a 100% failure rate.
 */
const MIN_SAMPLE = 20

/** Fraction of attempted records that must fail for the rate arm to trip. */
const FAILURE_RATE_LIMIT = 0.5

/** Mutable per-slice tally of record outcomes. */
export interface RecordFailureTally {
  attempted: number
  failed: number
  consecutive: number
  /** Failure message → count, for naming the dominant cause when the breaker trips. */
  byMessage: Map<string, number>
}

export function newRecordFailureTally(): RecordFailureTally {
  return { attempted: 0, failed: 0, consecutive: 0, byMessage: new Map() }
}

/** A record landed — clears the consecutive-failure streak. */
export function tallySuccess(tally: RecordFailureTally): void {
  tally.attempted += 1
  tally.consecutive = 0
}

/** A record failed — counted, and its message kept for the dominant-cause report. */
export function tallyFailure(tally: RecordFailureTally, message: string): void {
  tally.attempted += 1
  tally.failed += 1
  tally.consecutive += 1
  tally.byMessage.set(message, (tally.byMessage.get(message) ?? 0) + 1)
}

/** The failure message seen most often, with its count. */
function dominant(tally: RecordFailureTally): { message: string; count: number } | null {
  let best: { message: string; count: number } | null = null
  for (const [message, count] of tally.byMessage) {
    if (!best || count > best.count) best = { message, count }
  }
  return best
}

/**
 * Has this slice failed so consistently that continuing is pointless? Returns the
 * operator-facing reason when it has, else `null`.
 *
 * Two arms, because the two systemic shapes look different: an outright broken write
 * path fails every record in a row (consecutive), while a mapping that only breaks
 * SOME shape of record fails most but not all of them (rate).
 */
export function systemicFailureReason(tally: RecordFailureTally): string | null {
  const consecutiveTripped = tally.consecutive >= CONSECUTIVE_LIMIT
  const rateTripped =
    tally.attempted >= MIN_SAMPLE && tally.failed / tally.attempted > FAILURE_RATE_LIMIT
  if (!consecutiveTripped && !rateTripped) return null

  const top = dominant(tally)
  const scope = consecutiveTripped
    ? `${tally.consecutive} records in a row failed`
    : `${tally.failed} of ${tally.attempted} records failed`
  const cause = top ? ` Most common cause (${top.count}×): ${top.message}` : ''
  return `Sync stopped — this looks like a configuration problem, not bad data: ${scope}.${cause}`
}

/**
 * Thrown when the breaker trips. Distinct from a per-record failure: it propagates out
 * of the sink, through the slice loop's rethrow, and closes the RUN as failed — which
 * is the point. Nothing catches it on the way.
 */
export class SystemicSyncFailureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SystemicSyncFailureError'
  }
}
