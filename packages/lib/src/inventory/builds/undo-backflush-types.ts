// packages/lib/src/inventory/builds/undo-backflush-types.ts

/** The contract of an undo run over batch runs (plans/mrp/17 §8, Q1). Types only, client-safe. */

import type { BackflushRunStatus } from './backflush-types'

/** `backflush`: every backflush batch run of the org. `run`: the one run the drawer card names. */
export type UndoBackflushScope = 'backflush' | 'run'

/** A build the undo could not cancel or reverse, with the reason verbatim. */
export interface UndoBackflushFailure {
  runNumber: number
  buildId: string
  reason: string
}

/** `SyncJob.metadata` of an undo run: the runs to undo, the checkpoint and the running counts. */
export interface UndoBackflushRunMetadata {
  scope: UndoBackflushScope
  /** Newest first; captured at claim, so a run started later is not swept in. */
  runNumbers: number[]
  actorUserId: string
  /** `<runIndex>|<createdAtMs>|<buildId>` of the last build handled; `<runIndex>|` at a run's start. */
  cursor: string | null
  cancelled: number
  reversed: number
  skipped: number
  failed: number
  failures: UndoBackflushFailure[]
  recoveries: number
  finalizedAt: string | null
}

/** An undo run as the panel and the drawer card read it. */
export interface UndoBackflushRun {
  runId: string
  status: BackflushRunStatus
  scope: UndoBackflushScope
  runNumbers: number[]
  /** Builds to cancel or reverse, counted at claim. */
  total: number
  processed: number
  cancelled: number
  reversed: number
  skipped: number
  failed: number
  failures: UndoBackflushFailure[]
  error: string | null
  startedAt: Date
  endedAt: Date | null
  finalizedAt: string | null
}
