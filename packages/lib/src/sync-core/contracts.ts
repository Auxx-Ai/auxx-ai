// packages/lib/src/sync-core/contracts.ts
// Shared sync core — the channel-agnostic, sink-agnostic contracts both
// `runDataConnectorSync` and the channel `MessageSyncService` orchestrate through.
// Pure types only: no runtime imports, no provider specifics. The core persists
// cursor/watermark/phase and never interprets them — pagination and the sink live
// inside each `SyncSource.fetchSlice`. See plans/data-connectors/v3/shared-sync-core-plan.md.

/** Engine-managed lifecycle phase of a stream (orthogonal to the user's syncMode). */
export type SyncPhase = 'backfill' | 'steady'

/**
 * Opaque pagination cursor. The core stores and forwards it but NEVER interprets
 * `value` — every provider's locator (Gmail historyId, Outlook deltaLink, Stripe
 * last-id, Salesforce locator, generic page token) collapses into this. `kind` is
 * advisory metadata for debugging/UX, not branched on by the core.
 */
export interface SyncCursor {
  kind: 'token' | 'nextUrl' | 'headerLocator' | 'offset' | 'pageNumber' | 'historyId' | 'deltaLink'
  value: string
}

/** Per-slice work budget. A slice stops at whichever limit it hits first. */
export interface SliceBudget {
  /** Hard cap on pages fetched in one slice. */
  maxPages: number
  /** Hard cap on records processed in one slice. */
  maxRecords: number
  /**
   * Wall-clock cap for ACTIVE work (fetch + sink), NOT counting throttle waits.
   * Set well under the BullMQ `lockDuration` (e.g. 25s budget / 90s lock). A slice
   * must never sleep on a throttle inside this budget — it yields early with
   * `hasMore: true` instead (see shared-sync-core-plan §3.2).
   */
  maxMs: number
}

/**
 * The cursor-safety verdict for a slice — the per-provider "don't advance on a
 * retriable failure" convention promoted to a first-class, core-enforced return value.
 * Three-state on purpose: a binary all|retriable forces a poison record at a page
 * boundary to either block the cursor forever or vanish silently.
 *
 * - `all`               — clean slice. Advance the cursor.
 * - `partial-retriable` — transient failures (429, 5xx, timeout). HOLD the cursor so
 *                         the next slice re-fetches; do not lose ground.
 * - `partial-permanent` — poison records (malformed, will never parse). ADVANCE the
 *                         cursor past them and feed the ledger's `failed` counter.
 *
 * Note: this intentionally supersedes the shared-sync-core-plan §8 phrasing
 * ("advances only on commit==='all'") with the §2.1 three-state model — the runner
 * advances on `all` AND `partial-permanent`, holding only on `partial-retriable`.
 */
export type SliceCommit = 'all' | 'partial-retriable' | 'partial-permanent'

/**
 * Counters the core accumulates into the run ledger. Superset shape; channels
 * populate a subset, data-connectors populate most. Open-ended so a sink can add
 * category-specific counts without a contract change (they land in the ledger's
 * jsonb counters blob — shared-sync-core-plan §3.4).
 */
export interface SyncRunCounters {
  fetched: number
  created: number
  updated: number
  skipped: number
  archived: number
  deleted: number
  failed: number
  [key: string]: number
}

/**
 * Durable per-stream sync state. The `SyncStateStore` maps this onto whatever the
 * sink uses for persistence (data-connectors: `DataConnectorStream.state` jsonb;
 * channels: `Integration` columns). The core reads/writes it as an opaque blob.
 */
export interface SyncState {
  phase: SyncPhase
  /** Durable page cursor, checkpointed AFTER every committed slice. */
  cursor?: SyncCursor
  /** Steady-phase delta floor; the source returns a monotonic max each slice. */
  watermark?: string
  /** Running total for the progress UI (counts, never a percent). */
  recordsSeen?: number
  backfillStartedAt?: string
  /** Cross-run throttle hard-gate (ported from the channel side). */
  throttle?: { failureCount: number; retryAfter?: string }
}

/**
 * A throttle gate handed to `fetchSlice`. Wraps `UniversalThrottler` keyed by
 * `connection:operation` (shared-sync-core-plan §3.3) so two sources on the same
 * upstream account share one budget. The source runs each upstream call through it.
 */
export interface ThrottleHandle {
  run<T>(fn: () => Promise<T>): Promise<T>
}

/** Everything a slice needs. The core builds this; the source consumes it. */
export interface SyncSliceCtx {
  phase: SyncPhase
  cursor?: SyncCursor
  watermark?: string
  budget: SliceBudget
  throttle: ThrottleHandle
  /** Cancellation — the cancellable-worker hook aborts between/within slices. */
  signal: AbortSignal
}

/** What a slice reports back. The source fetches, sinks, AND parses; the core orchestrates. */
export interface SliceResult {
  /** Records processed this slice (advances `recordsSeen`). */
  recordsProcessed: number
  /** Pages fetched this slice (folded into the ledger's `pagesProcessed`). */
  pagesProcessed?: number
  /** Wall-clock the source spent waiting on rate limits this slice (ledger metric). */
  rateLimitWaitMs?: number
  /** Cursor to resume from; ignored when `commit === 'partial-retriable'`. */
  nextCursor?: SyncCursor
  /** False ⇒ the source is exhausted for this phase (backfill done / no new deltas). */
  hasMore: boolean
  /** Monotonic max watermark observed this slice (must be >= ctx.watermark). */
  watermark?: string
  commit: SliceCommit
  /** Counter deltas for this slice, folded into the run ledger. */
  counters?: Partial<SyncRunCounters>
}

/**
 * One slice's contribution to the run ledger. The runner builds this; the
 * `RunLedger` implementation folds it in idempotently (H4).
 */
export interface SliceLedgerEntry {
  /** Entity counter deltas (created/updated/skipped/…). */
  counters?: Partial<SyncRunCounters>
  /** Pages fetched this slice. */
  pagesProcessed?: number
  /** Rate-limit wait this slice. */
  rateLimitWaitMs?: number
  /**
   * Idempotency key — the serialized POST-slice cursor. A continuation chain is
   * sequential (the per-connector claim serializes it), so a BullMQ job replay that
   * already committed its fold presents the SAME key; the ledger MUST skip the
   * re-fold (else `created`/`updated` double-count — H4). Absent ⇒ always fold
   * (e.g. a held-cursor retry or a single-shot steady pass).
   */
  checkpointKey?: string
}

/**
 * The one method each side implements. Channels wrap `provider.syncMessages`;
 * data-connectors wrap `definition.fetch → mapRecord → entitySink`. The sink lives
 * INSIDE the slice (deliberate — channel fetch↔ingest is coupled). The core never
 * branches on provider; all provider specifics stay here.
 */
export interface SyncSource {
  /** Stable id for logging/correlation. */
  readonly id: string
  /** `${connectionId}:${operation}` — the throttle bucket key (§3.3). */
  readonly throttleKey: string
  /** Process one bounded slice: fetch pages up to budget, sink them, report progress. */
  fetchSlice(ctx: SyncSliceCtx): Promise<SliceResult>
  /**
   * Fired ONCE when backfill completes (phase flips to steady), BEFORE the flip.
   * Where the sink runs its reconciliation/orphan-archive — gated here so a partial
   * backfill never archives what it hasn't reached.
   *
   * It ALSO owns RUN finalization for the backfill phase: the runner does NOT call
   * `ledger.finalize()` on backfill completion, because a backfill can span many
   * stream chains sharing one run and only the consumer knows when the LAST one is
   * done. A multi-stream source therefore gates here (e.g. an atomic latch) and calls
   * `ledger.finalize()` itself on the final stream. No-op for sources with neither
   * reconciliation nor multi-chain coordination (steady runs finalize in the runner).
   */
  finalizeBackfill?(): Promise<void>
}

/** Persistence seam for `SyncState`. Implemented per sink. */
export interface SyncStateStore {
  load(): Promise<SyncState>
  save(state: SyncState): Promise<void>
}

/**
 * Run ledger seam. Implemented over `DataConnectorRun` today, `SyncRun` once the
 * tables merge (§3.4). `recordSlice` MUST touch the run's heartbeat (`updatedAt`) so
 * the stale-sweep distinguishes "alive but slow" from "dead" across a continuation chain.
 */
export interface RunLedger {
  /** Fold a slice's counters in (idempotently, by `checkpointKey`) and bump the
   *  checkpoint heartbeat + page/wait metrics. */
  recordSlice(entry: SliceLedgerEntry): Promise<void>
  /** Close the run; the implementation derives completed/partial from accumulated `failed`. */
  finalize(): Promise<void>
  /** Close the run as failed with the terminal error. */
  fail(error: Error): Promise<void>
}
