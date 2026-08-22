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
import type {
  SyncChangeManifest,
  SyncChangeManifestV1,
} from '../../record-rules/sync-manifest-types'
import type { AuxxEvent, SyncRecordsChangedEvent } from '../types'

const logger = createScopedLogger('dedup-sync')

/**
 * The event's manifest pointer: `ref` on new events, falling back to the deprecated
 * per-source fields for in-flight legacy events (one-release window).
 */
function manifestRef(data: SyncRecordsChangedEvent['data']): string | undefined {
  return data.ref ?? (data.source === 'connector' ? data.runId : data.importRef)
}

/**
 * Resolve the manifest a pointer event refers to (connector run row / import job row),
 * upgrading v1 rows written before the v2 deploy at this read edge (same shim as the
 * record-rules consumer — delete with `SyncChangeManifestV1` after one release).
 */
async function resolveManifest(
  data: SyncRecordsChangedEvent['data']
): Promise<SyncChangeManifest | null> {
  const ref = manifestRef(data)
  if (!ref) return null
  const { database } = await import('@auxx/database')
  let stored: SyncChangeManifest | SyncChangeManifestV1 | null
  if (data.source === 'connector') {
    const { getRunManifest } = await import('../../data-connectors/service')
    stored = await getRunManifest(database, ref)
  } else {
    const { getImportManifest } = await import('../../import')
    stored = await getImportManifest(database, ref)
  }
  if (!stored) return null
  if (stored.version === 2) return stored
  const { upgradeManifestV1 } = await import('../../record-rules/sync-manifest-collector')
  return upgradeManifestV1(stored)
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
 * Scope is `createdRecordIds` + every touched record (tier-1 membership — no
 * rule subscriptions required, so a zero-rules org's runs are scanned too).
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
        ref: manifestRef(data),
      })
      return
    }

    const recordIds = [
      ...new Set<string>([...manifest.createdRecordIds, ...Object.keys(manifest.touched)]),
    ]
    if (recordIds.length === 0) return

    // Stable per-RUN id. A re-entered connector finalize re-publishes the pointer
    // event and BullMQ can redeliver the handler job; both collapse onto this.
    const scopeKey = manifestRef(data)
    if (!scopeKey) {
      logger.warn('sync:records:changed with no manifest ref — bailing', {
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
      detailTruncated: manifest.detailTruncated,
      membershipTruncated: manifest.membershipTruncated,
    })
  } catch (error) {
    logger.error('Sync duplicate-scan enqueue failed', {
      organizationId,
      ref: manifestRef(data),
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
