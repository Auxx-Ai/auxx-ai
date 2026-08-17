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
   * Sync-change manifest collector (B2). Accumulates subscribed field writes +
   * lifecycle ids as the sink writes (which suppress per-write events via
   * `skipEvents`), so record rules can react at finalize. The no-op stub when the org
   * has no enabled rules — capture sites gate on `manifest.enabled`.
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
   * Reconciliation sweep run (Step 8C). A sweep is a full id-crawl whose purpose is
   * to catch deletes the watermark poll/webhooks missed. When set, `reconcileOrphans`
   * archives unseen orphans even for `incremental` streams (absence IS deletion,
   * because the crawl is complete-by-construction) — still gated on the FINAL slice.
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
    }>
  >
}
