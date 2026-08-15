// packages/lib/src/events/handlers/handle-sync-duplicate-scan.ts
//
// Dispatch door 3, second consumer: the dedup half of the sync-change manifest.
// Connector runs and CSV imports write with `skipEvents`, so they never reach the
// mutation seam that enqueues the coalesced scan — this handler is how their
// records get scanned with per-run freshness instead of waiting up to 6h for the
// sweep. One seam covers BOTH writers; `execute-plan-job.ts` stays untouched.
//
// Keep top-level imports to types/logger only; lazy-import everything else (the
// dedup ↔ data-connectors ↔ cache boundaries break vi.mock otherwise, exactly as
// they do for the record-rules consumer next door).

import { createScopedLogger } from '@auxx/logger'
import type { SyncChangeManifest } from '../../record-rules/sync-manifest-types'
import type { AuxxEvent, SyncRecordsChangedEvent } from '../types'

const logger = createScopedLogger('dedup-sync')

/** Resolve the manifest a pointer event refers to (connector run row / import job row). */
async function resolveManifest(
  data: SyncRecordsChangedEvent['data']
): Promise<SyncChangeManifest | null> {
  const { database } = await import('@auxx/database')
  if (data.source === 'connector') {
    if (!data.runId) return null
    const { getRunManifest } = await import('../../data-connectors/service')
    return getRunManifest(database, data.runId)
  }
  if (!data.importRef) return null
  const { getImportManifest } = await import('../../import')
  return getImportManifest(database, data.importRef)
}

/**
 * Enqueue ONE duplicate scan for everything a bulk run touched.
 *
 * ⚠️ **Never claims the manifest.** `claimManifest` is the record-rules
 * consumer's once-only latch — rule actions carry no idempotency of their own,
 * so exactly one claimant may proceed. A second claimant here would win the race
 * sometimes and STARVE record rules for that run. Dedup needs no latch: the
 * per-run `jobId` gives at-most-once, and pair upserts conflict on the canonical
 * pair key, so even a duplicate delivery that slips past the jobId is a no-op
 * beyond a refreshed `updatedAt`.
 *
 * Scope is `createdRecordIds` + every record with captured field changes.
 * Archived ids are deliberately absent: an archived record is not a duplicate
 * subject, and `archiveEntity` already deleted its open pairs.
 */
export const handleSyncDuplicateScan = async ({ data: event }: { data: AuxxEvent }) => {
  if (event.type !== 'sync:records:changed') return
  const data = event.data
  const { organizationId } = data

  try {
    // Cheap bail first — an org without the feature must not pay for a manifest
    // read, and this mirrors the rules handler's zero-rules early return.
    const { FeaturePermissionService } = await import(
      '../../permissions/feature-permission-service'
    )
    const { FeatureKey } = await import('../../permissions/types')
    const features = new FeaturePermissionService()
    if (!(await features.hasAccess(organizationId, FeatureKey.duplicateDetection))) return

    const manifest = await resolveManifest(data)
    if (!manifest) {
      logger.warn('sync:records:changed with no resolvable manifest — bailing', {
        source: data.source,
        runId: data.runId,
        importRef: data.importRef,
      })
      return
    }

    const recordIds = [
      ...new Set<string>([...manifest.createdRecordIds, ...Object.keys(manifest.changes)]),
    ]
    if (recordIds.length === 0) return

    // Stable per-RUN id. A re-entered connector finalize re-publishes the pointer
    // event and BullMQ can redeliver the handler job; both collapse onto this.
    const scopeKey = data.runId ?? data.importRef
    if (!scopeKey) {
      logger.warn('sync:records:changed with neither runId nor importRef — bailing', {
        organizationId,
        source: data.source,
      })
      return
    }

    const { enqueueDuplicateScanForRecords } = await import('../../dedup/enqueue-scan')
    await enqueueDuplicateScanForRecords({ organizationId, recordIds, scopeKey })

    logger.info('duplicate scan enqueued for sync run', {
      organizationId,
      source: data.source,
      scopeKey,
      records: recordIds.length,
      truncated: manifest.truncated,
    })
  } catch (error) {
    logger.error('Sync duplicate-scan enqueue failed', {
      organizationId,
      runId: data.runId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
