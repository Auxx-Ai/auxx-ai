// packages/lib/src/events/handlers/finalize-integrity-passes.ts
//
// The sync lane's replay of the registered field-change hook chain (plans/events/10 §4.4):
// the manifest projects to VALUELESS changes, marks run from those alone and derives run
// through their `batch` cores. Two hand-written passes survive because they key on
// membership rather than on a field, and they run after the dispatch so the evidence rows
// it writes are in place (`record-events.ts:185`). Lazy-import everything but types and the
// logger — the events ↔ money/geocoding/cache boundaries break `vi.mock` otherwise.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import type { DispatchChange } from '../../field-hooks/dispatch'
import type { SyncChangeManifest } from '../../record-rules/sync-manifest-types'
import type { DefEntityTypeResolver } from './passes/fulfillment-log-pass'

const logger = createScopedLogger('finalize-integrity')

/** Actor for everything dispatched from a manifest — same fallback the sync finalize doors use. */
const SYSTEM_ACTOR = 'system'

export interface IntegrityPassesInput {
  organizationId: string
  manifest: SyncChangeManifest
}

/**
 * Dispatch the hook chain for everything a sync run changed, then run the two membership-keyed
 * passes.
 *
 * NEVER throws: `dispatchFieldChanges` guards every handler, both passes guard themselves, and
 * this wraps the lot (mirrors `runSyncFinalize`'s contract).
 */
export async function runIntegrityPasses(db: Database, input: IntegrityPassesInput): Promise<void> {
  const { organizationId, manifest } = input
  try {
    // An archived-only manifest still has work (a deleted line means its order asks production
    // for less), and a created-only one does too: the fulfillment pass reads `createdRecordIds`,
    // the tier documented as unconditional.
    if (
      Object.keys(manifest.touched).length === 0 &&
      (manifest.archivedRecordIds?.length ?? 0) === 0 &&
      (manifest.createdRecordIds?.length ?? 0) === 0
    ) {
      return
    }

    const resolveDef = await buildDefEntityTypeResolver(organizationId)

    const [{ dispatchFieldChanges }, { runWithDirtyParents }] = await Promise.all([
      import('../../field-hooks/dispatch'),
      import('../../reconcilers/dirty-parents'),
    ])

    // One scope around both, so the marks the dispatch makes and the ones the archived lines
    // make coalesce into a single drain per reconciler.
    await runWithDirtyParents(organizationId, SYSTEM_ACTOR, async () => {
      await dispatchFieldChanges({
        organizationId,
        userId: SYSTEM_ACTOR,
        lane: 'sync',
        db,
        changes: fromManifest(manifest),
        degraded: idsOnly(manifest),
      })
      await markArchivedLines(organizationId, manifest, resolveDef)
    })

    // The one hole the manifest cannot close by itself: past `MAX_TOUCHED_RECORDS` it stops
    // recording members at all, so the tail waits for the nightly sweep.
    if (manifest.membershipTruncated) {
      logger.warn('sync manifest membership truncated — hook tail deferred', { organizationId })
    }

    const { fulfillmentPostingTriggerPass } = await import('./passes/fulfillment-log-pass')
    await fulfillmentPostingTriggerPass(db, organizationId, manifest, resolveDef)

    const { reconcileFinancialRecordsAfterBulk } = await import(
      '../../accounting/money/customer-money/record-events'
    )
    await reconcileFinancialRecordsAfterBulk(db, organizationId, manifest)
  } catch (error) {
    logger.error('integrity passes failed', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// =============================================================================
// Manifest → dispatch input
// =============================================================================

/**
 * Tier-1 `touched` keys, no values. Tier-2 `deltas` are deliberately NOT read: they are gated
 * on rule subscriptions and would under-select exactly the way bug B-1 described (an imported
 * address only geocoded when a rule happened to watch the field).
 */
function fromManifest(manifest: SyncChangeManifest): DispatchChange[] {
  const changes: DispatchChange[] = []
  for (const [rid, touched] of Object.entries(manifest.touched) as [RecordId, string[] | 1][]) {
    if (touched === 1) continue
    for (const outputKey of touched) changes.push({ recordId: rid, outputKey })
  }
  return changes
}

/** Records whose keys were shed under the byte budget — the dispatch degrades them to marks. */
function idsOnly(manifest: SyncChangeManifest): RecordId[] {
  const ids: RecordId[] = []
  for (const [rid, touched] of Object.entries(manifest.touched) as [RecordId, string[] | 1][]) {
    if (touched === 1) ids.push(rid)
  }
  return ids
}

/**
 * An archived line asks its order for less, and archival fires no field change at all — so the
 * one thing the manifest's `touched` keys cannot express is marked by hand here. The drift
 * reconciler resolves the parents for the whole batch in one query at the drain.
 */
async function markArchivedLines(
  organizationId: string,
  manifest: SyncChangeManifest,
  resolveDef: DefEntityTypeResolver
): Promise<void> {
  const lineInstanceIds: string[] = []
  for (const rid of manifest.archivedRecordIds ?? []) {
    const { entityDefinitionId: rawDefId, entityInstanceId } = parseRecordId(rid)
    const def = await resolveDef(rawDefId)
    if (def?.entityType === 'line_item') lineInstanceIds.push(entityInstanceId)
  }
  if (lineInstanceIds.length === 0) return

  try {
    const { markOrStampOrderLine } = await import('../../inventory/builds/drift-reconciler')
    for (const lineInstanceId of lineInstanceIds) {
      await markOrStampOrderLine(organizationId, lineInstanceId)
    }
  } catch (error) {
    logger.error('archived line marking failed', {
      organizationId,
      lines: lineInstanceIds.length,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Memoizing entityType resolver over the RecordId def prefix (slug for imports, CUID for
 * connectors — `findCachedResource` matches id, entityType and apiSlug). Null for unknown defs
 * and on cache hiccups: a skipped record beats a thrown pass.
 */
async function buildDefEntityTypeResolver(organizationId: string): Promise<DefEntityTypeResolver> {
  const { findCachedResource } = await import('../../cache')
  const memo = new Map<string, Promise<{ entityType: string | null } | null>>()
  return (rawDefId: string) => {
    let pending = memo.get(rawDefId)
    if (!pending) {
      pending = findCachedResource(organizationId, rawDefId)
        .then((resource) => (resource ? { entityType: resource.entityType ?? null } : null))
        .catch((error) => {
          logger.warn('def resolution failed — skipping def', {
            organizationId,
            rawDefId,
            error: error instanceof Error ? error.message : String(error),
          })
          return null
        })
      memo.set(rawDefId, pending)
    }
    return pending
  }
}
