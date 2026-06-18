// packages/lib/src/data-connectors/sinks/types.ts
// Shared sync context + sink contract. The sink is the ONLY entity writer.

import type { Database } from '@auxx/database'
import type { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import type { DataConnectorRow, DecodedMapping, PendingRelation, RunCounters } from '../service'

/** A single projected write produced by the mapping layer (04 §1a). */
export interface ProjectedRecord {
  externalId: string
  displayName: string
  /** Mapped to TARGET field keys (the mapping layer already evaluated CALC). */
  fields: Record<string, unknown>
  /**
   * Identity match values resolved from the SOURCE record (matchField/composite),
   * each pairing a target field with the source value it must equal. Pre-resolved
   * by the mapping layer because the sink has no access to the source subtree.
   * Empty for connectorExternalId / manualReview.
   */
  identityCandidates: Array<{
    targetFieldId: string
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
  /** Entity definition ids touched this run — invalidated once at the end. */
  touchedDefs: Set<string>
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
