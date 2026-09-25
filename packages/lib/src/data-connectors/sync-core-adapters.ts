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
 * preserving legacy/extra keys (`cursor` from the single-shot path, dead keys older
 * rows still carry, plus any connector-specific bookkeeping). Spread-first so only
 * the core-owned fields are overwritten.
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

// ── SyncStateStore over DataConnectorRun.progress.cursors (re-import) ───────────

/** One stream's page position inside a re-import run; never the stream's durable state. */
export type RunStreamCursor = Partial<
  Pick<SyncState, 'phase' | 'cursor' | 'recordsSeen' | 'noProgressStrikes'>
>

/**
 * A re-import keeps its page cursor on the run (v13 N5), so the stream's `state` stays
 * byte-identical. The watermark is never read nor stored: the fetch sends no delta.
 */
class RunSyncStateStore implements SyncStateStore {
  constructor(
    private readonly db: Database,
    private readonly runId: string,
    private readonly streamId: string
  ) {}

  async load(): Promise<SyncState> {
    const row = await this.db.query.DataConnectorRun.findFirst({
      where: eq(schema.DataConnectorRun.id, this.runId),
      columns: { progress: true },
    })
    const cursors = (row?.progress as { cursors?: Record<string, RunStreamCursor> } | null)?.cursors
    const own = cursors?.[this.streamId] ?? {}
    return {
      phase: own.phase ?? 'backfill',
      cursor: own.cursor,
      recordsSeen: own.recordsSeen,
      noProgressStrikes: own.noProgressStrikes,
    }
  }

  async save(sync: SyncState): Promise<void> {
    const own: RunStreamCursor = {
      phase: sync.phase,
      ...(sync.cursor ? { cursor: sync.cursor } : {}),
      recordsSeen: sync.recordsSeen ?? 0,
      noProgressStrikes: sync.noProgressStrikes ?? 0,
    }
    const T = schema.DataConnectorRun
    // Expression update, not read-modify-write: sibling stream chains share this row.
    await this.db
      .update(T)
      .set({
        progress: sql`jsonb_set(coalesce(${T.progress}, '{}'::jsonb), '{cursors}', coalesce(${T.progress}->'cursors', '{}'::jsonb) || jsonb_build_object(${this.streamId}::text, ${JSON.stringify(own)}::jsonb), true)`,
      })
      .where(eq(T.id, this.runId))
  }
}

/** Build a `SyncStateStore` over one re-import run's `progress.cursors.<streamId>`. */
export function createRunSyncStateStore(
  db: Database,
  runId: string,
  streamId: string
): SyncStateStore {
  return new RunSyncStateStore(db, runId, streamId)
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
      markedDeleted: sql`${T.markedDeleted} + ${c.markedDeleted ?? 0}`,
      restored: sql`${T.restored} + ${c.restored ?? 0}`,
      failed: sql`${T.failed} + ${c.failed ?? 0}`,
      // Finalize and park-time relationship passes count unresolved edges here; without
      // this fold every chained run reports 0 warnings however many edges stay pending.
      relationshipWarnings: sql`${T.relationshipWarnings} + ${c.relationshipWarnings ?? 0}`,
      pagesProcessed: sql`${T.pagesProcessed} + ${entry.pagesProcessed ?? 0}`,
      rateLimitWaitMs: sql`${T.rateLimitWaitMs} + ${entry.rateLimitWaitMs ?? 0}`,
      // Append this slice's dropped/failed sample onto the run row so a run that
      // silently drops every field value can't present as clean (Step 9 §8). Soft-
      // capped at ~50 entries (stop appending past 50) — it's a sample, not a log.
      // No sample this slice ⇒ self-assign so a NULL stays NULL (the clean-run shape).
      errorSample: entry.errorSample?.length
        ? sql`CASE WHEN jsonb_array_length(coalesce(${T.errorSample}, '[]'::jsonb)) < 50
            THEN coalesce(${T.errorSample}, '[]'::jsonb) || ${JSON.stringify(entry.errorSample)}::jsonb
            ELSE ${T.errorSample} END`
        : sql`${T.errorSample}`,
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
      columns: { failed: true, errorSample: true },
    })
    // A run is 'partial' if the entity write threw (`failed`) OR any record/field was
    // dropped before the write (an `errorSample` entry — e.g. an unresolved field ref).
    // Pre-write drops don't bump `failed`, so without this an all-dropped run reported
    // `completed / failed: 0` while writing no data (Step 9 §8). A `skipped` entry is a
    // deliberate, explained outcome (a sibling-bound exclusive match, task 39 section 6.1)
    // and must not keep every later run partial.
    const dropped = (row?.errorSample ?? []).some((e) => e.tier !== 'skipped')
    const status = (row?.failed ?? 0) > 0 || dropped ? 'partial' : 'completed'
    await this.db
      .update(T)
      .set({ status, finishedAt: new Date(), durationMs: Date.now() - this.startedAt.getTime() })
      .where(
        and(
          eq(T.id, this.runId),
          eq(T.status, 'running'),
          sql`coalesce(${T.progress}->'paused'->>'reason', '') <> 'manual'`
        )
      )
  }

  async fail(error: Error): Promise<void> {
    const T = schema.DataConnectorRun
    const pausing = sql`${T.progress}->'paused'->>'reason' = 'manual'`
    await this.db
      .update(T)
      .set({
        status: sql`case when ${pausing} then ${T.status} else 'failed' end`,
        errorSample: sql`coalesce(${T.errorSample}, '[]'::jsonb) || ${JSON.stringify([
          { externalId: '', error: error.message },
        ])}::jsonb`,
        finishedAt: sql`case when ${pausing} then ${T.finishedAt} else now() end`,
        durationMs: Date.now() - this.startedAt.getTime(),
      })
      .where(and(eq(T.id, this.runId), eq(T.status, 'running')))
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
