// packages/lib/src/data-connectors/reconciliation.ts
// Orphan reconciliation + explicit deletes (04 §4).
//
// Orphan reconciliation runs ONLY for owned + snapshot + upsert mappings: an
// item row whose lastSeenRunId !== this run is an orphan → archiveRecord with the
// mapping's orphanBehavior. Skipped for incremental (absence ≠ deletion), for
// reference mappings (they write nothing), and for ALL contributing mode (never
// archive a co-owned helpdesk record).
//
// Explicit deletes flow through the connector's resolveDelete → archiveRecord.

import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getFieldId, type ResourceFieldId } from '@auxx/types/field'
import { and, eq, notInArray } from 'drizzle-orm'
import { resolveConnectorFieldRef } from '../agents/bindings/resolve'
import { connectorFor } from './connectors'
import { buildWriteKeyToFieldId } from './field-id-resolver'
import { type DecodedMapping, findItem, type StreamWithMappings } from './service'
import { entitySink } from './sinks/entity-sink'
import type { SyncCtx } from './sinks/types'
import type { SyncMode } from './types'

const logger = createScopedLogger('data-connector-reconciliation')

/** The slice of a stream reconciliation needs: its sync mode + decoded mappings. */
type ReconcilableStream = { syncMode: SyncMode; mappings: DecodedMapping[] }

/**
 * Archive orphans for eligible mappings. `streams` carries each stream's syncMode
 * so we can gate snapshot-only. Only owned + snapshot + upsert mappings reconcile.
 * Accepts both the full `StreamWithMappings` (single-shot) and the pinned snapshot
 * shape (sliced chain) — it reads only `syncMode` + `mappings`.
 */
export async function reconcileOrphans(ctx: SyncCtx, streams: ReconcilableStream[]): Promise<void> {
  for (const { syncMode, mappings } of streams) {
    // Incremental: absence ≠ deletion — ALWAYS. Since v9 §3 a sweep runs incremental
    // streams as a watermark catch-up (they did NOT see every record), so the old
    // sweep override would mass-archive them. Deletes on incremental streams are
    // carried by delete webhooks; a stream that needs crawl-based delete detection
    // must be syncMode='snapshot'.
    if (syncMode !== 'snapshot') continue
    for (const mapping of mappings) {
      if (mapping.targetMode !== 'owned') continue // never archive co-owned records
      if (mapping.linkMode !== 'upsert') continue // reference mappings write nothing
      if (mapping.orphanBehavior === 'ignore') continue

      const items = await entitySink.listExistingItems(ctx, mapping)
      for (const item of items) {
        if (item.lastSeenRunId === ctx.runId) continue // seen this run
        await entitySink.archiveRecord(ctx, item, mapping.orphanBehavior)
      }
    }
  }
}

/**
 * Un-manage stale contributing markers (Field Lock & Provenance, Phase 2.6).
 *
 * The FK `set null` on `FieldValue.managedByConnectorId` covers connector
 * *deletion*. This pass covers the case the FK can't: a connector that still
 * exists but whose mapping no longer writes a field — its old `managedBy` marker
 * should be cleared so the cell stops showing "Synced by <connector>".
 *
 * For each target def this connector contributes to, we union the concrete
 * `CustomField.id`s it currently writes (across all its contributing mappings on
 * that def) and clear any marker the connector still holds on a field outside
 * that set. One bounded UPDATE per def — scoped by the connector marker itself,
 * so it doesn't enumerate instances. Owned mappings are skipped (their
 * provenance is the column-grain `CustomField.dataConnectorId`).
 *
 * Safety: a currently-mapped ref that fails to resolve (e.g. an unbound/expired
 * `@app:` connection at finalize time) marks the def's keep-set INCOMPLETE, and
 * we skip the clearing UPDATE for that def entirely. Otherwise a transient
 * resolution blip would drop the unresolved field from the keep-set and wipe its
 * valid marker — and, if every ref failed, clear EVERY marker for the connector
 * on that def. Un-managing a genuinely-dropped field still works: it's simply
 * absent from `fieldMappings`, so the remaining (resolvable) refs form the
 * keep-set and the dropped field's marker clears.
 */
export async function reconcileManagedMarkers(
  ctx: SyncCtx,
  streams: ReconcilableStream[]
): Promise<void> {
  const connectionId = ctx.connector.credentialId ?? undefined
  // Per target def: the concrete CustomField.id set this connector currently
  // writes, plus whether every currently-mapped ref resolved this run.
  const byDef = new Map<string, { keep: Set<string>; complete: boolean }>()

  for (const { mappings } of streams) {
    for (const mapping of mappings) {
      if (mapping.targetMode !== 'contributing') continue

      const keyToId = await buildWriteKeyToFieldId(ctx.orgId, mapping.entityDefinitionId)
      const entry = byDef.get(mapping.entityDefinitionId) ?? {
        keep: new Set<string>(),
        complete: true,
      }

      for (const fm of mapping.fieldMappings) {
        if (fm.targetFieldRef == null) continue // unassigned draft — not a managed field
        const resolved = await resolveConnectorFieldRef(
          fm.targetFieldRef as ResourceFieldId,
          ctx.orgId,
          connectionId
        )
        const id = resolved ? keyToId.get(getFieldId(resolved)) : undefined
        if (id) entry.keep.add(id)
        // A mapped ref we couldn't resolve to a concrete field — don't risk
        // clearing this def's markers on an incomplete view.
        else entry.complete = false
      }
      byDef.set(mapping.entityDefinitionId, entry)
    }
  }

  for (const [defId, { keep, complete }] of byDef) {
    if (!complete) {
      logger.info('skipping managed-marker un-manage — incomplete field resolution', {
        connectorId: ctx.connector.id,
        entityDefinitionId: defId,
      })
      continue
    }
    const keepIds = Array.from(keep)
    await ctx.db
      .update(schema.FieldValue)
      .set({ managedByConnectorId: null })
      .where(
        and(
          eq(schema.FieldValue.organizationId, ctx.orgId),
          eq(schema.FieldValue.managedByConnectorId, ctx.connector.id),
          eq(schema.FieldValue.entityDefinitionId, defId),
          // Empty set (all refs resolved, none mapped) ⇒ clear every marker.
          keepIds.length > 0 ? notInArray(schema.FieldValue.fieldId, keepIds) : undefined
        )
      )
  }
}

/**
 * Handle an explicit upstream delete signal. Resolves the (streamKey, externalId)
 * via the connector, finds every bound item for that external id across the
 * connector's mappings, and archives them.
 */
export async function handleConnectorDelete(
  ctx: SyncCtx,
  streams: StreamWithMappings[],
  event: unknown
): Promise<void> {
  const connector = connectorFor(ctx.connector.type, {
    db: ctx.db,
    organizationId: ctx.orgId,
    connector: {
      id: ctx.connector.id,
      type: ctx.connector.type,
      credentialId: ctx.connector.credentialId,
      appInstallationId: ctx.connector.appInstallationId,
    },
  })
  const resolved = connector.resolveDelete?.(event) ?? null
  if (!resolved) {
    logger.info('connector.resolveDelete returned null — ignoring delete event', {
      connectorId: ctx.connector.id,
    })
    return
  }

  const stream = streams.find((s) => s.stream.streamKey === resolved.streamKey)
  if (!stream) return
  await archiveExternalId(ctx, stream.mappings, resolved.externalId)
}

/**
 * Archive every item bound to one external id across a stream's mappings — the
 * shared core of an explicit upstream delete (webhook resolveDelete, Step 8A, or a
 * provider delete event). Archives regardless of target mode (the upstream said so);
 * `ignore` orphan behavior is upgraded to `archive`. Increments `counters.deleted`
 * per archived binding.
 */
export async function archiveExternalId(
  ctx: SyncCtx,
  mappings: DecodedMapping[],
  externalId: string
): Promise<void> {
  for (const mapping of mappings) {
    const item = await findItem(ctx.db, ctx.connector.id, mapping.row.id, externalId)
    if (!item) continue
    await entitySink.archiveRecord(
      ctx,
      {
        id: item.id,
        entityInstanceId: item.entityInstanceId,
        entityDefinitionId: item.entityDefinitionId,
      },
      mapping.orphanBehavior === 'ignore' ? 'archive' : mapping.orphanBehavior
    )
    ctx.counters.deleted += 1
  }
}
