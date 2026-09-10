// packages/lib/src/data-connectors/sinks/types.ts
// Shared sync context + sink contract. The sink is the ONLY entity writer.

import type { Database } from '@auxx/database'
import type { ResourceFieldId } from '@auxx/types/field'
import type { ManifestCollector } from '../../record-rules/sync-manifest-collector'
import type { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import type { RecordFailureTally } from '../record-failure-tally'
import type { DataConnectorRow, DecodedMapping, PendingRelation, RunCounters } from '../service'

/** A single projected write produced by the mapping layer (04 §1a). */
export interface ProjectedRecord {
  externalId: string
  displayName: string
  /**
   * Mapped values keyed by the binding's `targetFieldRef` (a `ResourceFieldId`,
   * possibly the `@app:` form). The sink resolves each key to a concrete field id
   * before writing — see entity-sink's ref pre-pass. The mapping layer already
   * evaluated CALC.
   */
  fields: Record<string, unknown>
  /**
   * Secondary identity match values resolved from the SOURCE record (each bound
   * field flagged `match`), pairing a target field ref with the source value it
   * must equal. Pre-resolved by the mapping layer because the sink has no access
   * to the source subtree. Empty when no field is flagged → the record matches by
   * its external id only.
   */
  identityCandidates: Array<{
    targetFieldRef: ResourceFieldId
    value: unknown
    normalize?: 'email' | 'phone' | 'domain' | 'none'
    /**
     * The binding's `identityRole.exclusive`: a hit on a record a sibling of the
     * same mapping already binds is skipped, never bound (plan 39 section 6.1).
     */
    exclusive?: boolean
  }>
  /** Pending relations to register on this record's item (resolved in the two-pass). */
  pendingRelations: PendingRelation[]
  /** Upstream last-modified, if the source carries one. */
  upstreamUpdatedAt?: Date | null
}

/** Context threaded through one sync run. */
export interface SyncCtx {
  db: Database
  orgId: string
  connector: DataConnectorRow
  runId: string
  /** Shared, cache-warmed crud handler (owned-mode + contributing both use it). */
  crud: UnifiedCrudHandler
  /** Owned-mode handler with field-guard bypass (writes read-only connector fields). */
  ownedCrud: UnifiedCrudHandler
  /**
   * Inline-lane handler for the relationship pass ONLY (plan 03 §3.4). `crud`/
   * `ownedCrud` run under the run's silent `sync` session; a genuine edge change
   * must keep firing `entity:field:updated`, the activity touch, and record
   * rules, so the pass writes through this `automation`-session handler instead.
   * Phase 4 folds these writes into the sync collector's finalize replay.
   */
  relationshipCrud: UnifiedCrudHandler
  /** Mutable run counters. */
  counters: RunCounters
  /**
   * Per-record outcome tally backing the fault-isolation circuit breaker
   * (`record-failure-tally`). `sinkSourceRecord` counts a failing record here and
   * continues; when the failure RATE says the problem is the configuration rather
   * than the data, it trips and fails the run with the dominant cause named.
   */
  failureTally: RecordFailureTally
  /**
   * The slice's cancellation signal, so the per-record fault boundary can tell a
   * graceful abort (rethrow — the chain resumes later) from a record that genuinely
   * failed (count and move on).
   */
  signal?: AbortSignal
  /**
   * Sync-change manifest collector (B2, always real since plan 07). Accumulates
   * rule-subscribed tier-2 field deltas + lifecycle ids as the sink writes (which
   * suppress per-write events via the silent `sync` write session); tier-1 touched
   * membership is captured at the engine seams. Tier-2 capture sites gate on
   * `subscriptionsFor`, not a collector flag.
   */
  manifest: ManifestCollector
  /** Entity definition ids touched this run — invalidated once at the end. */
  touchedDefs: Set<string>
  /**
   * The bound connection's plaintext `metadata` (e.g. Shopify `shopDomain`) — the
   * source `connectionAppFields` bindings read from (`connectionMetaKey`). `null`
   * when the connector has no bound connection or the credential failed to load;
   * `undefined` is never persisted (always resolved once per ctx build).
   */
  connectionMeta?: Record<string, unknown> | null
  /**
   * Reconciliation sweep run (Step 8C). Its purpose is to catch deletes the webhooks
   * missed, and it is scheduled nightly (`data-connector-scheduler.ts`).
   *
   * ⚠️ CORRECTED (v12): this field does NOT make `reconcileOrphans` archive on an
   * `incremental` stream, and never has since v9 §3. A sweep is a full RECORD
   * re-crawl for `snapshot` streams and a cheap watermark catch-up for `incremental`
   * ones — the latter did not see every record, so absence there still is not
   * deletion. `reconcileOrphans` gates on `syncMode === 'snapshot'` unconditionally
   * and ignores this flag entirely; it is read only for logging and diagnostics.
   *
   * There is no id-only crawl in the engine today. That is what would let an
   * incremental stream reconcile deletes cheaply, and it is deferred (v12 Phase 9).
   */
  sweep?: boolean
  /**
   * Per-mapping drift cache (entity-sink). Maps a mapping id → the set of bound
   * instance ids whose `overwrite` cells were edited by someone other than this
   * connector (detected via a cleared/foreign `FieldValue.managedByConnectorId`).
   * The content-hash skip must NOT skip these — `overwrite` has to re-assert the
   * source value. Computed once per mapping per slice (one query, memoized as a
   * Promise so concurrent records share it), never per record.
   */
  driftByMapping?: Map<string, Promise<Set<string>>>
  /**
   * In-slice two-source dedupe (B1, locked): `mappingId::instanceId` → the
   * externalId of the FIRST source record that bound the instance this slice.
   * `managedByConnectorId` alone cannot tell two bindings of the same connector
   * apart, so two upstream records matching two aliases of one contact would
   * flip-flop the connector-owned row every run. Later source records resolving
   * to an already-claimed instance still upsert their `DataConnectorItem`
   * binding, but log + skip their field writes.
   */
  sliceWriteWinners?: Map<string, string>
}

/** The entity sink contract (04 §1b). */
export interface EntitySink {
  upsertRecord(ctx: SyncCtx, mapping: DecodedMapping, record: ProjectedRecord): Promise<void>
  archiveRecord(
    ctx: SyncCtx,
    item: { id: string; entityInstanceId: string | null; entityDefinitionId: string },
    behavior: 'archive' | 'mark_deleted' | 'ignore'
  ): Promise<void>
  listExistingItems(
    ctx: SyncCtx,
    mapping: DecodedMapping
  ): Promise<
    Array<{
      id: string
      entityInstanceId: string | null
      entityDefinitionId: string
      lastSeenRunId: string | null
      /**
       * True when THIS connector created the bound record. Crawl reconciliation reads
       * it to refuse archiving a record the connector merely matched and enriched (a
       * contact the mail ingest or a human made): absence upstream is not authority to
       * archive someone else's record, so that degrades to `mark_deleted`.
       */
      mintedInstance: boolean
      /** Already flagged gone upstream by an earlier reconcile — don't re-count it. */
      removedUpstreamAt: Date | null
      /**
       * Already archived by an earlier reconcile. Read so a handled orphan is not
       * re-archived on every subsequent crawl (it stays absent forever, so without
       * this it would re-enter the candidate set and the cap's arithmetic every run).
       */
      archivedAt: Date | null
    }>
  >
}
