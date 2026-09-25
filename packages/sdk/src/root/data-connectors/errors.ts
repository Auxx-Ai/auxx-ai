// packages/sdk/src/root/data-connectors/errors.ts

/**
 * Throw from `execute` when the provider rejects `query.since` as stale (a 410 on a sync
 * token, a 404 on a history id). The platform clears the marker and re-runs the backfill.
 */
export class DeltaExpiredError extends Error {
  // Matched by `code`, never `instanceof`: the error crosses the sandbox realm.
  readonly code = 'DELTA_EXPIRED'

  constructor(streamKey: string, reason?: string) {
    super(`Stream "${streamKey}" delta marker expired${reason ? `: ${reason}` : ''}`)
    this.name = 'DeltaExpiredError'
  }
}
