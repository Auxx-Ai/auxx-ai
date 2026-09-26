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

/** One part's share of a preview. */
export interface BackflushPlanPart {
  partId: string
  partName: string | null
  builds: number
  units: number
}

/** The preview as a request returns it: counts per part, not every build of a multi-year range. */
export interface BackflushPlanSummary {
  dayCount: number
  buildCount: number
  unitCount: number
  skipped: number
  failedDays: { day: string; reason: string }[]
  /** Most builds first. */
  parts: BackflushPlanPart[]
}

/** `SyncJob.status` of a backflush run. */
export type BackflushRunStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'

/** A build or a day the run could not write, with the reason verbatim. */
export interface BackflushRunFailure {
  day: string
  partName: string | null
  reason: string
}

/** `SyncJob.metadata` of a backflush run: the range, the checkpoint and the running counts. */
export interface BackflushRunMetadata {
  from: string
  to: string
  /** Allocated at enqueue, so every slice and retry shares one undo batch. */
  batchRun: number
  actorUserId: string
  /** The last day walked, `YYYY-MM-DD`; `null` before the first slice. */
  cursor: string | null
  written: number
  leftInProgress: number
  failedBuilds: number
  failedDays: number
  /** Parts rolled before their first build this run (111 Q20), so a later slice does not roll again. */
  rolled: string[]
  /** The first few failures. */
  failures: BackflushRunFailure[]
  /** Times the stale sweep re-enqueued the run. */
  recoveries: number
  finalizedAt: string | null
}

/** A backflush run as the dialog reads it. */
export interface BackflushRun {
  runId: string
  status: BackflushRunStatus
  from: string
  to: string
  batchRun: number
  totalDays: number
  processedDays: number
  written: number
  /** Failed and refused builds plus unreadable days. */
  failed: number
  failures: BackflushRunFailure[]
  error: string | null
  startedAt: Date
  endedAt: Date | null
  finalizedAt: string | null
}
