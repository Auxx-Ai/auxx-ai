// packages/lib/src/evals/types.ts
//
// Runtime-only types for the evals service layer (NOT persisted contracts —
// those live in `@auxx/types/evals`). See plans/evals/phase-1-agent-simulation.md §1.3.

import type { DatabaseError } from '@auxx/services'
import type { CompileError } from '../agents/procedures'

/** Not-found / validation failures returned by the eval service layer. */
export type EvalServiceError =
  | DatabaseError
  | { code: 'EVAL_VALIDATION'; message: string; cause?: unknown }
  /**
   * A draft failed to compile at prepare time. User-correctable (the router maps
   * it to 422, never 500); carries the per-node `CompileError[]` so the editor
   * can render an inline error list.
   */
  | { code: 'DRAFT_COMPILE_FAILED'; message: string; errors: CompileError[] }
  | { code: 'EVAL_CASE_NOT_FOUND'; message: string }
  | { code: 'EVAL_RUN_NOT_FOUND'; message: string }
  | { code: 'EVAL_SUITE_RUN_NOT_FOUND'; message: string }
  /** A suite verdict diff was requested while one side is still queued/running. */
  | { code: 'SUITE_NOT_TERMINAL'; message: string }
  /**
   * The suggestion call itself was unusable — model error, truncated output, or
   * unparseable top-level JSON. Per-item problems never produce this; they
   * increment the result's `dropped` count. Zero valid suggestions is NOT an
   * error: that returns `{ suggestions: [], dropped: n }`.
   */
  | { code: 'EVAL_SUGGESTION_FAILED'; message: string; cause?: unknown }

/**
 * Run-level execution/grading failure codes (persisted to `EvalRun.errorCode`).
 * Distinct from assertion failures: an `error` status means the run could not
 * complete, never that an assertion was false.
 */
export type EvalRunErrorCode =
  | 'ENQUEUE_FAILED'
  | 'SNAPSHOT_INCOMPATIBLE'
  | 'UNMATCHED_MOCK'
  | 'TURN_CAP_EXCEEDED'
  | 'MODEL_ERROR'
  | 'GRADER_ERROR'
  | 'EXECUTION_ERROR'
  | 'TIMED_OUT'

/**
 * The persisted runtime snapshot. The concrete `AgentRuntimeSnapshotV1` shape is
 * assembled by the effective-agent runtime builder (Phase 1.4); the service/
 * lifecycle layer only needs to persist and hash it, so it stays opaque here.
 */
export type RuntimeSnapshot = Record<string, unknown>
