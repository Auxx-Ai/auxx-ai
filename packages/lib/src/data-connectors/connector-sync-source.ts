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

import { getCredential } from '@auxx/credentials/store'
import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { RuntimeConnectionData } from '../connections/resolve-connection-for-runtime'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import type { SliceResult, SyncRunCounters, SyncSliceCtx, SyncSource } from '../sync-core/contracts'
import { runAsyncExportSlice } from './async-export'
import { flattenConnectionMeta } from './connection-meta'
import { runConnectorSlice } from './connector-slice-loop'
import { reconcileManagedMarkers, reconcileOrphans } from './reconciliation'
import { newRecordFailureTally } from './record-failure-tally'
import { resolveRelationships } from './relationship-pass'
import {
  clearResyncPending,
  countConnectorItems,
  type DataConnectorRow,
  type DecodedMapping,
  decrementConnectorBackfillLatch,
  finalizeConnector,
  foldRunManifest,
  markRunManifestDegraded,
  newRunCounters,
  parkConnectorSampleIfLastStream,
  publishSyncRecordsChanged,
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
   * Reconciliation sweep (Step 8C, REVISED v9 §3). Self-heals missed webhooks: a
   * `syncMode='incremental'` stream fetches a cheap watermark catch-up instead of a
   * full re-crawl (and, per `reconcileOrphans`, never archives — absence ≠ deletion
   * even under a sweep, since it no longer saw every record); a `syncMode='snapshot'`
   * stream still full re-crawls + archives orphans as before.
   */
  sweep?: boolean
  /**
   * Per-stream sample cap (trial-sync §4.2). Set ⇒ this is a SAMPLE run: when a stream
   * exhausts its backfill BEFORE hitting the cap (source smaller than the sample), the
   * runner's natural-completion path fires `finalizeBackfill` here — which must park the
   * run for review (gated on the last stream) rather than finalize the connector live.
   * Streams that hit the cap park via the orchestrator instead; both funnel through
   * `parkConnectorSampleIfLastStream`.
   */
  sampleLimit?: number | null
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
  /** Per-record upstream last-modified path (`incremental.watermarkField`) → the
   *  `upstreamUpdatedAt` version stamp the sink's out-of-order guard reads (§9 Q7). */
  private readonly updatedAtPath?: string
  /** Cache the cache-warmed crud handlers across this instance's calls. */
  private crud?: UnifiedCrudHandler
  private ownedCrud?: UnifiedCrudHandler
  private readonly warmedDefs = new Set<string>()
  /** Bound connection's plaintext metadata (`connectionAppFields` source), loaded once. */
  private connectionMeta?: Record<string, unknown> | null

  constructor(private readonly deps: ConnectorSyncSourceDeps) {
    this.id = `${deps.connector.id}:${deps.stream.streamId}`
    // §3.3 throttle bucket: connection nested under operation. Two sources on one
    // upstream account share a budget; distinct operations stay separated.
    this.throttleKey = `${deps.connector.credentialId ?? deps.connector.id}:data-connector-sync`
    this.now = deps.now ?? (() => Date.now())
    this.updatedAtPath = deps.stream.requestConfig?.incremental?.watermarkField
  }

  async fetchSlice(ctx: SyncSliceCtx): Promise<SliceResult> {
    const counters = newRunCounters()
    const syncCtx = await this.buildCtx(counters, this.deps.stream.mappings, ctx.signal)
    // A stream needs no user-facing name to sync — fall back to the stable streamId
    // as the functional fetch/record key when it's unnamed.
    const streamKey = this.deps.stream.streamKey || this.deps.stream.streamId

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
        sink: (record) =>
          sinkSourceRecord(syncCtx, this.deps.stream.mappings, record, this.updatedAtPath),
      })
      await this.emitRecordsInvalidated(syncCtx.touchedDefs)
      await this.persistManifest(syncCtx)
      return { ...result, counters: toSyncCounters(counters), errorSample: counters.errorSample }
    }

    // Backfill paginates from the top/cursor (snapshot); steady incremental injects
    // the watermark delta floor (Step 5). The connector reads `state.backfillCursor`
    // to resume regardless, so backfill always passes 'snapshot'.
    //
    // A sweep self-heals missed webhooks. Incremental streams (honest updated_at) only
    // need a watermark catch-up — forcing a full re-crawl on them is what made sweeps
    // unaffordable on big stores (v9 §3). Snapshot streams still full-crawl (their
    // sources can't report deltas), which is also what keeps their orphan reconciliation
    // valid. `this.deps.sweep`, not `ctx.sweep` — `ctx: SyncSliceCtx` (sync-core) carries
    // no sweep flag; the sweep signal lives on this source's own deps (see `buildCtx`,
    // which threads the same `this.deps.sweep` onto `SyncCtx.sweep` for `reconcileOrphans`).
    const sweepIncremental = this.deps.sweep === true && this.deps.stream.syncMode === 'incremental'
    const mode: 'snapshot' | 'incremental' =
      (ctx.phase === 'steady' || sweepIncremental) && this.deps.stream.syncMode === 'incremental'
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
          signal: ctx.signal,
        }),
      sink: (record) =>
        sinkSourceRecord(syncCtx, this.deps.stream.mappings, record, this.updatedAtPath),
    })

    await this.emitRecordsInvalidated(syncCtx.touchedDefs)
    await this.persistManifest(syncCtx)
    return { ...result, counters: toSyncCounters(counters), errorSample: counters.errorSample }
  }

  /**
   * Refresh the grid for the slice just written: mark each touched def's query
   * emit ONE coarse `records:invalidated` per def.
   *
   * Per-record realtime is suppressed for connector writes (the sink passes
   * `skipEvents`), so this coarse event is what tells an open grid to refetch
   * instead of the per-record firehose that 403s Pusher at backfill scale. The
   * grid's refetch pages straight from SQL, so it always sees the fresh rows.
   */
  private async emitRecordsInvalidated(touchedDefs: Set<string>): Promise<void> {
    if (touchedDefs.size === 0) return
    const defIds = Array.from(touchedDefs)

    // Lazy-import the realtime barrel: a static import from this low-level module
    // creates a load-time cycle (realtime → publish-helpers → cache → …) that
    // silently breaks vi.mock interception in the smoke test. See the
    // ai-provider-configs-provider workaround for the same pattern.
    const { getRealtimeService, publishRecordsInvalidated } = await import('../realtime')
    await publishRecordsInvalidated(getRealtimeService(), this.deps.organizationId, {
      entityDefinitionIds: defIds,
    }).catch(() => {})
  }

  /**
   * B2: fold this slice's captured sync-change manifest into the run row. Best-effort —
   * a manifest failure must never fail the sync — but NOT silent: retry once (the
   * shared run row's `FOR UPDATE` makes transient lock contention the likely failure),
   * then stamp the manifest `truncated` so the consumer and the run UI see an
   * incomplete manifest instead of a full-looking one (F8 — a re-run can't recover the
   * loss anyway: the content-hash skip means re-synced unchanged records capture
   * nothing). No-op when nothing subscribed was captured (`toJson()` null).
   */
  private async persistManifest(ctx: SyncCtx): Promise<void> {
    const fragment = ctx.manifest.toJson()
    if (!fragment) return
    for (let attempt = 0; ; attempt++) {
      try {
        await foldRunManifest(this.deps.db, this.deps.run.id, fragment)
        return
      } catch (err) {
        if (attempt === 0) continue
        logger.error('failed to fold sync-change manifest — marking manifest degraded', {
          runId: this.deps.run.id,
          error: err instanceof Error ? err.message : String(err),
        })
        await markRunManifestDegraded(this.deps.db, this.deps.run.id).catch(() => {})
        return
      }
    }
  }

  /**
   * Fired by the RUNNER when THIS stream's BACKFILL exhausts (before the steady
   * flip). The last stream (B1 latch) runs the connector-wide finalize AND closes
   * the run — the runner delegates backfill run-finalization here since only the
   * last stream knows the whole multi-stream chain is done.
   */
  async finalizeBackfill(): Promise<void> {
    // Sample run: a stream that exhausted before its cap still parks for review (the
    // sample IS everything for this stream, but the run stays paused so the user
    // confirms before any capped sibling's remainder is pulled). No reconcile — a
    // sample is partial by construction; resolution runs on the full-sync resume.
    if (this.deps.sampleLimit != null) {
      await parkConnectorSampleIfLastStream(this.deps.db, {
        runId: this.deps.run.id,
        dataConnectorId: this.deps.connector.id,
        sampleLimit: this.deps.sampleLimit,
        startedAt: this.deps.run.startedAt,
      })
      return
    }
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
    // Final sweep: emit the coarse refresh so the grid
    // also reflects finalize-only writes (relationship resolution, orphan
    // archival) that the per-slice emits never saw.
    await this.emitRecordsInvalidated(syncCtx.touchedDefs)

    // Fold finalize-only counters (archived/deleted/relationshipWarnings). No
    // checkpoint key ⇒ always folds (runs exactly once, last stream only).
    const ledger = createConnectorRunLedger(this.deps.db, this.deps.run, this.deps.stream.streamId)
    await ledger.recordSlice({
      counters: toSyncCounters(counters),
      errorSample: counters.errorSample,
    })

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

    // B2: fold this finalize's writes (orphan archival, relationship resolution) into
    // the run manifest, THEN publish ONE pointer event for the whole run. This runs
    // once per run (last stream, past the backfill latch), by which point every slice
    // has folded — so the event points at the complete manifest.
    await this.persistManifest(syncCtx)
    await publishSyncRecordsChanged(this.deps.db, {
      organizationId: this.deps.organizationId,
      dataConnectorId: this.deps.connector.id,
      runId: this.deps.run.id,
    })

    // §7b run-completion edge on the org channel, aligned with the importer's.
    // Runs once per run (last stream, past the B1 latch), AFTER the finalize
    // writes, so the client's catch-up sees post-reconcile state. Per-def
    // changed counts are NOT cheaply available here — the run counters are
    // aggregate across streams and a stream can map several defs — so each
    // touched def ships count 0 ("changed, count unknown" per the event doc)
    // rather than adding new bookkeeping. Defs: every mapped def plus whatever
    // finalize itself touched (relationship resolution, orphan archival).
    try {
      const defCounts: Record<string, number> = {}
      for (const mapping of allMappings) defCounts[mapping.entityDefinitionId] ??= 0
      for (const defId of syncCtx.touchedDefs) defCounts[defId] ??= 0
      if (Object.keys(defCounts).length > 0) {
        // Lazy-import the realtime barrel — same cycle-avoidance as
        // `emitRecordsInvalidated`.
        const { getRealtimeService, publishRunCompleted } = await import('../realtime')
        await publishRunCompleted(getRealtimeService(), this.deps.organizationId, {
          source: 'connector',
          ref: this.deps.run.id,
          defCounts,
        })
      }
    } catch (err) {
      logger.error('failed to publish run:completed', {
        runId: this.deps.run.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // v9 inventory→part bridge: post-sink (the sink writes with skipEvents, so no
    // per-record hook fired) compare synced quantities to the watermark and deduct
    // linked parts. Best-effort — a bridge failure must never fail the sync run.
    // Lazy import: the pass pulls the cache/settings/crud barrels, which break the
    // mocked sync-source unit tests at module load (it never runs there anyway).
    try {
      const { runInventoryBridgePass } = await import('./inventory-bridge-pass')
      await runInventoryBridgePass(
        this.deps.db,
        this.deps.organizationId,
        this.deps.connector.id,
        allMappings.map((m) => m.entityDefinitionId)
      )
    } catch (err) {
      logger.error('inventory bridge pass failed', {
        connectorId: this.deps.connector.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /** Build a sink context with the given counters; reuses cache-warmed crud handlers. */
  private async buildCtx(
    counters: RunCounters,
    mappings: DecodedMapping[],
    signal?: AbortSignal
  ): Promise<SyncCtx> {
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
    if (this.connectionMeta === undefined) {
      this.connectionMeta = await this.loadConnectionMeta()
    }
    // B2: build a subscription-aware manifest collector (zero-cost no-op stub when the
    // org has no enabled record rules). Lazy-imported — crosses into record-rules.
    const { loadManifestCollector } = await import('../record-rules/sync-manifest-collector')
    const manifest = await loadManifestCollector(this.deps.organizationId)
    return {
      db: this.deps.db,
      orgId: this.deps.organizationId,
      connector: this.deps.connector,
      runId: this.deps.run.id,
      crud: this.crud,
      ownedCrud: this.ownedCrud,
      counters,
      failureTally: newRecordFailureTally(),
      signal,
      manifest,
      touchedDefs: new Set<string>(),
      sweep: this.deps.sweep ?? false,
      connectionMeta: this.connectionMeta,
    }
  }

  /** Load the bound connection's plaintext metadata once per instance (best-effort). */
  private async loadConnectionMeta(): Promise<Record<string, unknown> | null> {
    const credentialId = this.deps.connector.credentialId
    if (!credentialId) return null
    const result = await getCredential(credentialId, this.deps.organizationId)
    if (result.isErr()) {
      logger.warn('Failed to load connection metadata for connectionAppFields', {
        connectorId: this.deps.connector.id,
        credentialId,
        error: result.error.message,
      })
      return null
    }
    return flattenConnectionMeta(result.value)
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
