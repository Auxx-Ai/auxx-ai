// packages/lib/src/data-connectors/connector-sync-source.ts
// The data-connector `SyncSource` (shared-sync-core-plan §2.1 / large-dataset §4).
// Wraps `definition.fetch → mapRecord → entitySink` as the one method the core
// orchestrates through, turning a stream's pagination into bounded, resumable
// SLICES. The slice loop (`runConnectorSlice`) is pure over injected fetch/sink
// callbacks so it unit-tests with fakes (B3); the class wires the real connector
// definition, the shared sink, and the connector-level finalize.
//
// Three correctness invariants live here:
//   H1 — a throttle NEVER sleeps in-slice. The fetch sets `maxRetries: 0`, the
//        transport surfaces a 429 as `ConnectorRateLimitError`, and the slice
//        YIELDS (made progress → advance + `hasMore`; zero progress → hold cursor
//        + `partial-retriable`) so the worker re-enqueues with a backoff instead
//        of blocking the BullMQ lock.
//   B1 — reconciliation is connector-level but each stream is its own chain, so
//        `finalizeBackfill` fires the connector finalize only when the ATOMIC
//        completion latch hits zero (the last stream), never a racy sibling count.
//   B2 — the chain decodes against a PINNED mapping snapshot (`mappings` captured
//        at construction), not live config — a mid-backfill edit can't skew slices.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { RuntimeConnectionData } from '../connections/resolve-connection-for-runtime'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { invalidateSnapshots } from '../snapshot'
import type { SliceResult, SyncRunCounters, SyncSliceCtx, SyncSource } from '../sync-core/contracts'
import { runAsyncExportSlice } from './async-export'
import { runConnectorSlice } from './connector-slice-loop'
import { reconcileManagedMarkers, reconcileOrphans } from './reconciliation'
import { resolveRelationships } from './relationship-pass'
import {
  clearResyncPending,
  countConnectorItems,
  type DataConnectorRow,
  type DecodedMapping,
  decrementConnectorBackfillLatch,
  finalizeConnector,
  newRunCounters,
  type RunCounters,
} from './service'
import { sinkSourceRecord } from './sink-source-record'
import type { SyncCtx } from './sinks/types'
import { createConnectorRunLedger } from './sync-core-adapters'
import type {
  DataConnectorConfig,
  DataConnectorDefinition,
  StreamRequestConfig,
  SyncMode,
} from './types'

const logger = createScopedLogger('data-connector-sync-source')

/**
 * The pinned, decoded view of one stream a `SyncSource` drives. Captured into the
 * run's `chainSnapshot` at backfill start (B2) so every slice in the chain decodes
 * against the SAME config even if the user edits mappings mid-backfill. Carries only
 * what fetch + sink + reconcile need — never the mutable stream `state` (the cursor
 * stays live via the `SyncStateStore`).
 */
export interface SyncSourceStream {
  streamId: string
  streamKey: string
  syncMode: SyncMode
  requestConfig?: StreamRequestConfig
  mappings: DecodedMapping[]
}

/** Owned-mode handler skips registered system-field pre-hooks (mirror the importer). */
const OWNED_BYPASS: ReadonlySet<never> = new Set<never>()

/** Map the mutable run counters onto the core's slice-counter shape for the ledger. */
function toSyncCounters(rc: RunCounters): Partial<SyncRunCounters> {
  return {
    fetched: rc.fetched,
    created: rc.created,
    updated: rc.updated,
    skipped: rc.skipped,
    archived: rc.archived,
    deleted: rc.deleted,
    failed: rc.failed,
    relationshipWarnings: rc.relationshipWarnings,
  }
}

// ── The wired SyncSource ────────────────────────────────────────────────────────

export interface ConnectorSyncSourceDeps {
  db: Database
  organizationId: string
  connector: DataConnectorRow
  definition: DataConnectorDefinition
  credential: RuntimeConnectionData | null
  config: DataConnectorConfig
  run: { id: string; startedAt: Date }
  /** The pinned stream this source drives (its own continuation chain). */
  stream: SyncSourceStream
  /**
   * Pinned snapshot of ALL the connector's enabled streams (B2). The per-stream
   * fetch uses `stream`; the connector-level finalize reconciles across all of
   * them. Decoded once at chain start so a mid-backfill config edit can't skew it.
   */
  allStreams: SyncSourceStream[]
  /**
   * Reconciliation sweep (Step 8C) — sets `ctx.sweep` so `reconcileOrphans` archives
   * orphans even for incremental streams (a full id-crawl: absence IS deletion).
   */
  sweep?: boolean
  /** Injectable clock for the slice budget (tests). Defaults to `Date.now`. */
  now?: () => number
}

/**
 * A `SyncSource` plus the handler-invoked steady finalize. `finalizeBackfill` is
 * fired by the runner (backfill, before the steady flip); `finalizeSteady` is fired
 * by the slice handler after a steady-phase completion (the runner already closed
 * the run). Both gate connector-level finalize on the B1 latch.
 */
export interface ConnectorSyncSource extends SyncSource {
  finalizeSteady(): Promise<void>
}

class ConnectorStreamSyncSource implements ConnectorSyncSource {
  readonly id: string
  readonly throttleKey: string

  private readonly now: () => number
  /** Cache the cache-warmed crud handlers across this instance's calls. */
  private crud?: UnifiedCrudHandler
  private ownedCrud?: UnifiedCrudHandler
  private readonly warmedDefs = new Set<string>()

  constructor(private readonly deps: ConnectorSyncSourceDeps) {
    this.id = `${deps.connector.id}:${deps.stream.streamId}`
    // §3.3 throttle bucket: connection nested under operation. Two sources on one
    // upstream account share a budget; distinct operations stay separated.
    this.throttleKey = `${deps.connector.credentialId ?? deps.connector.id}:data-connector-sync`
    this.now = deps.now ?? (() => Date.now())
  }

  async fetchSlice(ctx: SyncSliceCtx): Promise<SliceResult> {
    const counters = newRunCounters()
    const syncCtx = await this.buildCtx(counters, this.deps.stream.mappings)
    const streamKey = this.deps.stream.streamKey
    if (!streamKey) throw new Error(`SyncSource ${this.id}: stream has no streamKey`)

    // Async bulk export (Step 7): a large BACKFILL runs the initiate→poll→download
    // lifecycle instead of synchronous paging. Steady deltas still page/webhook, so
    // only the backfill phase branches here.
    if (this.deps.definition.asyncExport && ctx.phase === 'backfill') {
      const driver = this.deps.definition.asyncExport.createDriver({
        streamKey,
        credential: this.deps.credential,
        config: this.deps.config,
        requestConfig: this.deps.stream.requestConfig ?? undefined,
      })
      const result = await runAsyncExportSlice({
        ctx,
        driver,
        sink: (record) => sinkSourceRecord(syncCtx, this.deps.stream.mappings, record),
      })
      return { ...result, counters: toSyncCounters(counters) }
    }

    // Backfill paginates from the top/cursor (snapshot); steady incremental injects
    // the watermark delta floor (Step 5). The connector reads `state.backfillCursor`
    // to resume regardless, so backfill always passes 'snapshot'.
    const mode: 'snapshot' | 'incremental' =
      ctx.phase === 'steady' && this.deps.stream.syncMode === 'incremental'
        ? 'incremental'
        : 'snapshot'

    const result = await runConnectorSlice({
      ctx,
      now: this.now,
      fetch: ({ backfillCursor, watermark }) =>
        this.deps.definition.fetch({
          streamKey,
          mode,
          state: { backfillCursor, watermark },
          credential: this.deps.credential,
          config: this.deps.config,
          requestConfig: this.deps.stream.requestConfig ?? undefined,
          // H1 — never sleep on a throttle inside a slice.
          rateLimitOverride: { maxRetries: 0 },
        }),
      sink: (record) => sinkSourceRecord(syncCtx, this.deps.stream.mappings, record),
    })

    return { ...result, counters: toSyncCounters(counters) }
  }

  /**
   * Fired by the RUNNER when THIS stream's BACKFILL exhausts (before the steady
   * flip). The last stream (B1 latch) runs the connector-wide finalize AND closes
   * the run — the runner delegates backfill run-finalization here since only the
   * last stream knows the whole multi-stream chain is done.
   */
  async finalizeBackfill(): Promise<void> {
    await this.finalizeConnectorLevel({ finalizeRun: true, phase: 'backfill' })
  }

  /**
   * Fired by the slice HANDLER when THIS stream's STEADY pass completes (the runner
   * already closed the run for steady). The last stream resolves relationships +
   * reconciles (which self-skips incremental streams) and releases the connector.
   */
  async finalizeSteady(): Promise<void> {
    await this.finalizeConnectorLevel({ finalizeRun: false, phase: 'steady' })
  }

  /**
   * Connector-level finalize, gated on the LAST stream (B1 atomic latch). Runs the
   * relationship two-pass + orphan reconciliation across ALL streams, folds the
   * finalize counters, optionally closes the run, and releases the connector claim.
   * Shared by both phase completions so the lifecycle can't drift between them.
   */
  private async finalizeConnectorLevel(opts: {
    finalizeRun: boolean
    phase: 'backfill' | 'steady'
  }): Promise<void> {
    const remaining = await decrementConnectorBackfillLatch(this.deps.db, this.deps.connector.id)
    if (remaining !== null && remaining > 0) {
      logger.info('stream done; siblings still running — deferring finalize', {
        sourceId: this.id,
        phase: opts.phase,
        remaining,
      })
      return
    }

    logger.info('last stream done — running connector finalize', {
      sourceId: this.id,
      phase: opts.phase,
    })
    const counters = newRunCounters()
    // The finalize reconciles across ALL streams, so warm every target def.
    const allMappings = this.deps.allStreams.flatMap((s) => s.mappings)
    const syncCtx = await this.buildCtx(counters, allMappings)

    await resolveRelationships(syncCtx)
    // reconcileOrphans self-skips non-snapshot streams, so it's a no-op for steady.
    await reconcileOrphans(syncCtx, this.deps.allStreams)
    // Clear contributing markers for fields the connector no longer maps (the FK
    // set-null only covers connector deletion, not a reconfigured mapping).
    await reconcileManagedMarkers(syncCtx, this.deps.allStreams)
    for (const defId of syncCtx.touchedDefs) {
      await invalidateSnapshots({ organizationId: this.deps.organizationId, resourceType: defId })
    }

    // Fold finalize-only counters (archived/deleted/relationshipWarnings). No
    // checkpoint key ⇒ always folds (runs exactly once, last stream only).
    const ledger = createConnectorRunLedger(this.deps.db, this.deps.run, this.deps.stream.streamId)
    await ledger.recordSlice({ counters: toSyncCounters(counters) })

    // Close the run for backfill (delegated by the runner); steady already finalized
    // in the runner. Then release the connector claim + stamp the item count.
    if (opts.finalizeRun) await ledger.finalize()
    await finalizeConnector(this.deps.db, this.deps.connector.id, {
      ok: true,
      itemCount: await countConnectorItems(this.deps.db, this.deps.connector.id),
    })
    // A completed BACKFILL re-projected + re-bound all history, so any pending
    // mapping-edit re-sync is satisfied — clear the banner marker. A steady run
    // touches only deltas, so it must NOT clear a pending rebackfill/rebind.
    if (opts.phase === 'backfill') {
      await clearResyncPending(this.deps.db, this.deps.connector.id)
    }
  }

  /** Build a sink context with the given counters; reuses cache-warmed crud handlers. */
  private async buildCtx(counters: RunCounters, mappings: DecodedMapping[]): Promise<SyncCtx> {
    const userId = this.deps.connector.createdById ?? 'system'
    if (!this.crud)
      this.crud = new UnifiedCrudHandler(this.deps.organizationId, userId, this.deps.db)
    if (!this.ownedCrud) {
      this.ownedCrud = new UnifiedCrudHandler(
        this.deps.organizationId,
        userId,
        this.deps.db,
        undefined,
        {
          bypassFieldGuards: OWNED_BYPASS,
        }
      )
    }
    for (const m of mappings) {
      if (this.warmedDefs.has(m.entityDefinitionId)) continue
      await this.crud.warmCache(m.entityDefinitionId)
      await this.ownedCrud.warmCache(m.entityDefinitionId)
      this.warmedDefs.add(m.entityDefinitionId)
    }
    return {
      db: this.deps.db,
      orgId: this.deps.organizationId,
      connector: this.deps.connector,
      runId: this.deps.run.id,
      crud: this.crud,
      ownedCrud: this.ownedCrud,
      counters,
      touchedDefs: new Set<string>(),
      sweep: this.deps.sweep ?? false,
    }
  }
}

/**
 * Build the data-connector `SyncSource` for one stream's continuation chain. The
 * worker constructs one per slice (Step 4) from the connector definition + the
 * pinned mapping snapshot, hands it to `runSyncSlice`, and acts on the directive.
 */
export function createConnectorStreamSyncSource(
  deps: ConnectorSyncSourceDeps
): ConnectorSyncSource {
  return new ConnectorStreamSyncSource(deps)
}
