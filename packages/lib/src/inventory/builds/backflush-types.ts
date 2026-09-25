// packages/lib/src/inventory/builds/backflush-types.ts

/** The contract of the backflush (111 D23/D24). Types only, client-safe. */

/** One build the replay calls for: one part, one local day. */
export interface BackflushBuild {
  partId: string
  partName: string | null
  /** The local day the build covers, `YYYY-MM-DD` in the book time zone. */
  day: string
  /** Its accounting date: 23:59:59.999 of `day`. */
  completedAt: Date
  /** The shortfall: `-qoh(day)`. Always positive. */
  quantity: number
}

/** What a run over a range would write, in write order (days ascending, parents first). */
export interface BackflushPlan {
  /** Every local day walked, `YYYY-MM-DD`. Days whose end is still in the future are never walked. */
  days: string[]
  builds: BackflushBuild[]
  buildCount: number
  unitCount: number
  /** (part, day) checks that found `qoh >= 0`. */
  skipped: number
  /** Days whose ledger read failed; no part was checked for them. */
  failedDays: { day: string; reason: string }[]
}

/** What one run did. Never throws; a failure is a row in here. */
export interface BackflushRunSummary {
  /** The `build_batch_run` every build carries, `undoBatchRun`'s handle; `null` when nothing was raised. */
  batchRun: number | null
  days: string[]
  /** Builds completed. */
  written: (BackflushBuild & { buildId: string })[]
  /** Builds raised whose completion was refused, with the refusal verbatim. */
  leftInProgress: (BackflushBuild & { buildId: string; reason: string })[]
  /** Builds that produced nothing at all. */
  failed: (BackflushBuild & { reason: string })[]
  /** Days whose ledger read failed; no part was checked for them. */
  failedDays: { day: string; reason: string }[]
  skipped: number
  /** Parts whose standard was rolled before their first build this run (111 Q20). */
  rolled: string[]
}
