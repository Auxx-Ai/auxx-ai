// packages/lib/src/data-connectors/sync-core-adapters.ts
// The data-connector implementations of the shared sync-core seams (Step 3). Two of
// the three adapters live here — the durable `SyncStateStore` over
// `DataConnectorStream.state` and the `RunLedger` over `DataConnectorRun`; the
// `SyncSource` (which wraps definition.fetch → mapRecord → entitySink) lives next to
// the connector runtime. The core orchestrates through these and never touches a DC
// table directly. See plans/data-connectors/v3/shared-sync-core-plan.md §3.

import { type Database, schema } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'
import type { RunLedger, SliceLedgerEntry, SyncState, SyncStateStore } from '../sync-core/contracts'
import { persistStreamState } from './service'
import type { ConnectorStreamState } from './types'

// ── Pure state mapping (unit-tested; the DB classes below just wire these) ──────

/**
 * Project the persisted per-stream `ConnectorStreamState` onto the core's
 * `SyncState`. `backfillCursor` is the structured `SyncCursor` (H6 — no lossy
 * round-trip). A stream with no recorded phase is treated as `backfill` (it has
 * never run a slice).
 */
export function syncStateFromStream(state: ConnectorStreamState): SyncState {
  return {
    phase: state.phase ?? 'backfill',
    cursor: state.backfillCursor,
    watermark: state.watermark,
    recordsSeen: state.recordsSeen,
    backfillStartedAt: state.backfillStartedAt,
    noProgressStrikes: state.noProgressStrikes,
  }
}

/**
 * Merge a core `SyncState` back onto the persisted `ConnectorStreamState`,
 * preserving legacy/extra keys (`cursor`/`backfillComplete` from the single-shot
 * path, plus any connector-specific bookkeeping). Spread-first so only the
 * core-owned fields are overwritten.
 */
export function applySyncStateToStream(
  prev: ConnectorStreamState,
  sync: SyncState
): ConnectorStreamState {
  return {
    ...prev,
    phase: sync.phase,
    backfillCursor: sync.cursor,
    watermark: sync.watermark,
    recordsSeen: sync.recordsSeen,
    backfillStartedAt: sync.backfillStartedAt,
    noProgressStrikes: sync.noProgressStrikes,
  }
}

// ── SyncStateStore over DataConnectorStream.state ───────────────────────────────

class StreamSyncStateStore implements SyncStateStore {
  constructor(
    private readonly db: Database,
    private readonly streamId: string
  ) {}

  async load(): Promise<SyncState> {
    const row = await this.db.query.DataConnectorStream.findFirst({
      where: eq(schema.DataConnectorStream.id, this.streamId),
      columns: { state: true },
    })
    return syncStateFromStream((row?.state as ConnectorStreamState) ?? {})
  }

  async save(sync: SyncState): Promise<void> {
    // Read-modify-write to preserve the legacy/extra keys the core doesn't own. Safe
    // without a lock because a stream's continuation chain is serialized (one slice
    // at a time under the per-connector claim — Step 4).
    const row = await this.db.query.DataConnectorStream.findFirst({
      where: eq(schema.DataConnectorStream.id, this.streamId),
      columns: { state: true },
    })
    const prev = (row?.state as ConnectorStreamState) ?? {}
    await persistStreamState(this.db, this.streamId, applySyncStateToStream(prev, sync))
  }
}

/** Build a `SyncStateStore` bound to one stream's `state` jsonb. */
export function createStreamSyncStateStore(db: Database, streamId: string): SyncStateStore {
  return new StreamSyncStateStore(db, streamId)
}

// ── RunLedger over DataConnectorRun ─────────────────────────────────────────────

class ConnectorRunLedger implements RunLedger {
  constructor(
    private readonly db: Database,
    private readonly runId: string,
    private readonly startedAt: Date,
    /**
     * Per-stream idempotency scope. A run is shared by ALL the connector's stream
     * chains, so the H4 dedup key must be namespaced per stream — otherwise two
     * concurrent streams (or two streams that happen to page-number identically)
     * overwrite each other's `lastCheckpointKey` and drop folds. Defaults to a
     * single shared slot for the finalize ledger (which folds with no key anyway).
     */
    private readonly scopeId: string = 'default'
  ) {}

  /**
   * Fold a slice's counters + metrics into the run row, idempotently keyed by
   * `checkpointKey` (H4). A BullMQ job replay that already committed its fold
   * presents the same key; the conditional `WHERE` makes the second fold a no-op,
   * so `created`/`updated` can't double-count. The `heartbeatAt` column auto-bumps
   * on any update (its `$onUpdate`), which is what the stale-run sweep keys off.
   */
  async recordSlice(entry: SliceLedgerEntry): Promise<void> {
    const c = entry.counters ?? {}
    const T = schema.DataConnectorRun
    const increments = {
      fetched: sql`${T.fetched} + ${c.fetched ?? 0}`,
      created: sql`${T.created} + ${c.created ?? 0}`,
      updated: sql`${T.updated} + ${c.updated ?? 0}`,
      skipped: sql`${T.skipped} + ${c.skipped ?? 0}`,
      archived: sql`${T.archived} + ${c.archived ?? 0}`,
      deleted: sql`${T.deleted} + ${c.deleted ?? 0}`,
      failed: sql`${T.failed} + ${c.failed ?? 0}`,
      pagesProcessed: sql`${T.pagesProcessed} + ${entry.pagesProcessed ?? 0}`,
      rateLimitWaitMs: sql`${T.rateLimitWaitMs} + ${entry.rateLimitWaitMs ?? 0}`,
      heartbeatAt: new Date(),
    }

    // No idempotency key (held-cursor retry / single-shot steady): always fold.
    if (!entry.checkpointKey) {
      await this.db.update(T).set(increments).where(eq(T.id, this.runId))
      return
    }

    // Fold only if this checkpoint hasn't already been recorded for THIS stream; stamp
    // it so a replay of the same slice is skipped. Keyed under `progress.checkpoints.
    // <streamId>` so sibling stream chains sharing this run never clobber each other.
    const folded = await this.db
      .update(T)
      .set({
        ...increments,
        progress: sql`jsonb_set(coalesce(${T.progress}, '{}'::jsonb), array['checkpoints', ${this.scopeId}], to_jsonb(${entry.checkpointKey}::text), true)`,
      })
      .where(
        and(
          eq(T.id, this.runId),
          sql`coalesce(${T.progress} #>> array['checkpoints', ${this.scopeId}], '') <> ${entry.checkpointKey}`
        )
      )
      .returning({ id: T.id })

    // Duplicate replay — the fold already landed; just keep the heartbeat warm.
    if (folded.length === 0) {
      await this.db.update(T).set({ heartbeatAt: new Date() }).where(eq(T.id, this.runId))
    }
  }

  async finalize(): Promise<void> {
    const T = schema.DataConnectorRun
    const row = await this.db.query.DataConnectorRun.findFirst({
      where: eq(T.id, this.runId),
      columns: { failed: true },
    })
    const status = (row?.failed ?? 0) > 0 ? 'partial' : 'completed'
    await this.db
      .update(T)
      .set({ status, finishedAt: new Date(), durationMs: Date.now() - this.startedAt.getTime() })
      .where(eq(T.id, this.runId))
  }

  async fail(error: Error): Promise<void> {
    const T = schema.DataConnectorRun
    await this.db
      .update(T)
      .set({
        status: 'failed',
        errorSample: sql`coalesce(${T.errorSample}, '[]'::jsonb) || ${JSON.stringify([
          { externalId: '', error: error.message },
        ])}::jsonb`,
        finishedAt: new Date(),
        durationMs: Date.now() - this.startedAt.getTime(),
      })
      .where(eq(T.id, this.runId))
  }
}

/**
 * Build a `RunLedger` bound to one `DataConnectorRun`. Pass `scopeId` (the stream
 * id) to namespace the H4 idempotency key per stream chain — required whenever the
 * ledger records slice checkpoints (the finalize-only ledger can omit it).
 */
export function createConnectorRunLedger(
  db: Database,
  run: { id: string; startedAt: Date },
  scopeId?: string
): RunLedger {
  return new ConnectorRunLedger(db, run.id, run.startedAt, scopeId)
}
