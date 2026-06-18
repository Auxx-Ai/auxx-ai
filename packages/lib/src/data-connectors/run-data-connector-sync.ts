// packages/lib/src/data-connectors/run-data-connector-sync.ts
// Orchestrator (04 §2). Never branches on provider — connectorFor(type) decides
// how to fetch; the mapping layer fans out; the sink lands each record. Streams
// records (never buffers), persists each stream's cursor after it completes,
// runs the relationship two-pass + orphan reconciliation, then finalizes.

import { revealSecrets } from '@auxx/credentials/store'
import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { invalidateSnapshots } from '../snapshot'
import { connectorFor } from './connectors'
import type { DecryptedCredential } from './connectors/types'
import { mapRecord } from './map-record'
import { reconcileOrphans } from './reconciliation'
import { resolveRelationships } from './relationship-pass'
import {
  claimForSync,
  type DecodedMapping,
  finalizeConnector,
  finalizeRun,
  loadConnector,
  newRunCounters,
  openRun,
  persistStreamState,
} from './service'
import { entitySink } from './sinks/entity-sink'
import type { ProjectedRecord, SyncCtx } from './sinks/types'
import type { ConnectorStreamState } from './types'

const logger = createScopedLogger('run-data-connector-sync')

/**
 * `bypassFieldGuards` lets the owned-mode handler skip registered system-field
 * PRE-HOOKS (e.g. ticket-status guards) the same way the seeder does. The core
 * field-value write path does NOT hard-reject on `isUpdatable:false` (the
 * importer writes read-only fields with no bypass and succeeds) — that flag
 * only blocks USER edits at the UI + mutation layers (02 §4). Owned-mode
 * connector defs carry custom fields with no system pre-hooks, so an empty
 * bypass is correct for v1; phase 4 can widen this per-connector if a
 * contributed-to system def ever needs a guarded attribute.
 */
const OWNED_BYPASS: ReadonlySet<never> = new Set<never>()

/** Decrypt the connector's borrowed credential, or null when none/failed. */
async function decryptCredential(
  organizationId: string,
  credentialId: string | null
): Promise<DecryptedCredential | null> {
  if (!credentialId) return null
  const result = await revealSecrets<Record<string, unknown>>(credentialId, organizationId)
  if (result.isErr()) {
    logger.warn('failed to reveal credential — proceeding without', {
      credentialId,
      error: result.error.code,
    })
    return null
  }
  // Merge non-sensitive metadata with decrypted secrets (secrets win).
  return { ...result.value.record.metadata, ...result.value.secrets }
}

/**
 * Run a full sync for one connector. Loads streams + mappings, claims the
 * connector, decrypts the credential, fetches + maps + sinks each stream, then
 * runs the two-pass + reconciliation and finalizes run + connector status.
 */
export async function runDataConnectorSync(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  options: { trigger?: 'manual' | 'scheduled' | 'webhook' | 'backfill' } = {}
): Promise<void> {
  const loaded = await loadConnector(db, organizationId, dataConnectorId)
  if (!loaded) {
    logger.warn('runDataConnectorSync: connector not found or has no mappings', {
      dataConnectorId,
    })
    return
  }
  const { connector, streams } = loaded

  // Concurrency guard — claim by flipping status → syncing only if not already.
  const claimed = await claimForSync(db, dataConnectorId)
  if (!claimed) {
    logger.info('runDataConnectorSync: already syncing, skipping', { dataConnectorId })
    return
  }

  // A connector run is incremental if ALL its enabled streams are incremental;
  // otherwise it's a snapshot run (the ledger records the dominant mode).
  const mode: 'snapshot' | 'incremental' = streams.every((s) => s.syncMode === 'incremental')
    ? 'incremental'
    : 'snapshot'

  const startedAt = new Date()
  const run = await openRun(db, {
    dataConnectorId,
    organizationId,
    trigger: options.trigger ?? 'manual',
    mode,
    cursorBefore: connector.state,
  })

  const counters = newRunCounters()
  const credential = await decryptCredential(organizationId, connector.credentialId)
  // App connectors fetch through the sandbox (the adapter resolves its own
  // runtime connection); built-ins ignore the context and use `credential`.
  const definition = connectorFor(connector.type, {
    db,
    organizationId,
    connector: {
      id: connector.id,
      type: connector.type,
      credentialId: connector.credentialId,
      appInstallationId: connector.appInstallationId,
    },
  })

  const ctx: SyncCtx = {
    db,
    orgId: organizationId,
    connector,
    runId: run.id,
    crud: new UnifiedCrudHandler(organizationId, connector.createdById ?? 'system', db),
    ownedCrud: new UnifiedCrudHandler(
      organizationId,
      connector.createdById ?? 'system',
      db,
      undefined,
      {
        bypassFieldGuards: OWNED_BYPASS,
      }
    ),
    counters,
    touchedDefs: new Set<string>(),
  }

  try {
    // Warm caches for every target def up front (importer bulk-upsert shape).
    const defIds = new Set<string>()
    for (const s of streams) for (const m of s.mappings) defIds.add(m.entityDefinitionId)
    for (const defId of defIds) {
      await ctx.crud.warmCache(defId)
      await ctx.ownedCrud.warmCache(defId)
    }

    for (const { stream, syncMode, mappings } of streams) {
      const streamMode: 'snapshot' | 'incremental' =
        syncMode === 'incremental' ? 'incremental' : 'snapshot'
      const state = (stream.state as ConnectorStreamState) ?? {}

      const { records, nextState } = await definition.fetch({
        streamKey: stream.streamKey,
        mode: streamMode,
        state,
        credential,
        config: connector.config,
        requestConfig: stream.requestConfig ?? undefined,
      })

      for await (const source of records) {
        await sinkSourceRecord(ctx, mappings, source)
      }

      // Persist the stream cursor AFTER the stream completes (crash resumes).
      await persistStreamState(db, stream.id, nextState as Record<string, unknown>)
    }

    // Relationship two-pass — resolve pending edges across all streams.
    await resolveRelationships(ctx)

    // Orphan reconciliation — owned + snapshot + upsert mappings only.
    await reconcileOrphans(ctx, streams)

    // Single snapshot invalidation per touched def (importer shape).
    for (const defId of ctx.touchedDefs) {
      await invalidateSnapshots({ organizationId, resourceType: defId })
    }

    // Item count = bound items for this connector.
    const itemCount = await countItems(db, dataConnectorId)
    const status = counters.failed > 0 ? 'partial' : 'completed'
    await finalizeRun(db, run.id, { status, counters, cursorAfter: connector.state, startedAt })
    await finalizeConnector(db, dataConnectorId, { ok: true, itemCount })
    logger.info('runDataConnectorSync: complete', {
      dataConnectorId,
      counters: { created: counters.created, updated: counters.updated, skipped: counters.skipped },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('runDataConnectorSync: failed', { dataConnectorId, error: message })
    await finalizeRun(db, run.id, { status: 'failed', counters, startedAt })
    await finalizeConnector(db, dataConnectorId, { ok: false, error: message })
  }
}

/** Key a projected write by its mapping + instance external id (fan-out safe). */
function instanceKey(mappingId: string, externalId: string): string {
  return `${mappingId}::${externalId}`
}

/**
 * Map one connector payload across the mapping tree and sink each projected
 * write. Stamps child→parent relations onto the parent INSTANCE's projected
 * record so the binding carries them into the two-pass. Parents are written
 * before their children (walk order) so the edge target exists.
 */
async function sinkSourceRecord(
  ctx: SyncCtx,
  mappings: DecodedMapping[],
  source: Parameters<typeof mapRecord>[1]
): Promise<void> {
  const writes = mapRecord(mappings, source)

  // Index projected writes by (mapping, instance) so a child attaches its edge to
  // the exact parent instance's pendingRelations before that parent is sunk.
  const projectedByInstance = new Map<string, ProjectedRecord>()
  for (const w of writes) {
    if (w.projected) {
      projectedByInstance.set(instanceKey(w.mapping.row.id, w.projected.externalId), w.projected)
    }
  }
  for (const w of writes) {
    if (!w.parentRelation) continue
    const parent = projectedByInstance.get(
      instanceKey(w.parentRelation.parentMappingId, w.parentRelation.parentExternalId)
    )
    if (parent) {
      parent.pendingRelations.push({
        fieldKey: w.parentRelation.fieldKey,
        targetMappingId: w.parentRelation.targetMappingId,
        targetExternalId: w.parentRelation.targetExternalId,
      })
    }
  }

  // Write in order (parents before children) so the parent exists for the edge.
  for (const w of writes) {
    if (!w.projected) continue
    await entitySink.upsertRecord(ctx, w.mapping, w.projected)
  }
}

/** Count bound items for the connector (powers DataConnector.itemCount). */
async function countItems(db: Database, dataConnectorId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.DataConnectorItem.id })
    .from(schema.DataConnectorItem)
    .where(eq(schema.DataConnectorItem.dataConnectorId, dataConnectorId))
  return rows.length
}
