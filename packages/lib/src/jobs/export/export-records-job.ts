// packages/lib/src/jobs/export/export-records-job.ts

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { FieldReference } from '@auxx/types/field'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import type { ConditionGroup } from '../../conditions/types'
import type { ExportColumn } from '../../export'
import {
  buildRow,
  extractRelationRecordIds,
  getExportJobByOrg,
  indexByRecord,
  publishExportJob,
  serializeCsv,
  updateExportJob,
} from '../../export'
import { FieldValueService } from '../../field-values/field-value-service'
import type { TypedFieldValueResult } from '../../field-values/types'
import { StorageManager } from '../../files/storage/storage-manager'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import type { JobContext } from '../types'

const logger = createScopedLogger('export-records-job')

/** Records paged from `listFiltered` per iteration (also the `batchGetValues` id cap). */
const PAGE_SIZE = 500
/** `batchGetValues` caps field references at 50 — chunk wide views. */
const FIELD_REF_CHUNK = 50
/** Related-name hydration chunk (Postgres `IN (...)` param ceiling). */
const NAME_CHUNK = 500

/** Job payload for exporting entity records to CSV. */
export interface ExportRecordsJobData {
  exportJobId: string
  organizationId: string
}

/**
 * Background job: export entity records to a CSV in S3, driven by a snapshotted
 * table view (filters + sorting + ordered columns). Pages record IDs, batch-fetches
 * field values, hydrates relation display names (deduped + cached across the whole
 * export), formats each cell, then uploads the assembled CSV and marks the job done.
 */
export async function exportRecordsJob(ctx: JobContext<ExportRecordsJobData>): Promise<void> {
  const { exportJobId, organizationId } = ctx.data
  logger.info('Starting export', { exportJobId, organizationId })

  const job = await getExportJobByOrg(db, organizationId, exportJobId)
  if (!job) {
    throw new Error(`Export job not found: ${exportJobId}`)
  }

  const columns = job.columns as ExportColumn[]
  const filters = (job.filters ?? undefined) as ConditionGroup[] | undefined
  const sorting = job.sorting ?? undefined
  const fieldRefs = columns.map((c) => c.fieldRef as FieldReference)

  await updateExportJob(db, exportJobId, { status: 'processing', startedAt: new Date() })
  await publishExportJob(organizationId, { exportJobId, kind: 'started', status: 'processing' })

  let storageLocationId: string | null = null
  try {
    const handler = new UnifiedCrudHandler(organizationId, job.createdById, db)
    const fvs = new FieldValueService(organizationId, job.createdById, db)

    // Job-level cache so each related record's name is fetched at most once.
    const nameCache = new Map<RecordId, string>()
    const rows: string[][] = []
    let processed = 0

    // First page (snapshot mode) → frozen id list + total.
    let page = await handler.listFiltered({
      entityDefinitionId: job.entityDefinitionId,
      filters,
      sorting,
      limit: PAGE_SIZE,
      mode: 'snapshot',
    })
    await updateExportJob(db, exportJobId, { totalRecords: page.total })

    while (true) {
      ctx.throwIfCancelled()

      // `listFiltered` returns bare instance ids; wrap them into full RecordIds
      // (`entityDefId:instanceId`) before any value/name lookup — `batchGetValues`
      // and `getByIds` both parse the def prefix out of the id.
      const ids = page.ids.map((id) => toRecordId(job.entityDefinitionId, id))
      if (ids.length > 0) {
        const results = await fetchValues(fvs, ids, fieldRefs)
        await hydrateRelationNames(handler, results, nameCache)
        const byRecord = indexByRecord(results)
        for (const id of ids) rows.push(buildRow(id, columns, byRecord, nameCache))

        processed += ids.length
        await updateExportJob(db, exportJobId, { processedRecords: processed })
        if (page.total > 0) await ctx.updateProgress(Math.round((processed / page.total) * 100))
        await publishExportJob(organizationId, {
          exportJobId,
          kind: 'progress',
          processed,
          total: page.total,
        })
      }

      if (!page.hasMore) break
      page = await handler.listFiltered({
        entityDefinitionId: job.entityDefinitionId,
        filters,
        sorting,
        limit: PAGE_SIZE,
        cursor: { snapshotId: page.snapshotId, offset: processed },
      })
    }

    // Assemble + upload the CSV.
    const csv = serializeCsv(
      columns.map((c) => c.label),
      rows
    )
    const buffer = Buffer.from(csv, 'utf-8')
    const fileName = job.fileName ?? `export-${exportJobId}.csv`

    const storage = new StorageManager(organizationId)
    const location = await storage.uploadContent({
      provider: 'S3',
      key: `exports/${organizationId}/${exportJobId}/${fileName}`,
      content: buffer,
      mimeType: 'text/csv',
      size: buffer.byteLength,
      visibility: 'PRIVATE',
    })
    storageLocationId = location.id

    await updateExportJob(db, exportJobId, {
      status: 'completed',
      storageLocationId: location.id,
      fileName,
      fileSizeBytes: buffer.byteLength,
      completedAt: new Date(),
    })
    await publishExportJob(organizationId, {
      exportJobId,
      kind: 'finished',
      status: 'completed',
      fileName,
    })
    logger.info('Export completed', { exportJobId, processed, bytes: buffer.byteLength })
  } catch (error) {
    // If the upload succeeded but a later write failed, drop the orphaned object.
    if (storageLocationId) {
      await new StorageManager(organizationId).deleteFile(storageLocationId).catch(() => {})
    }
    const message = error instanceof Error ? error.message : String(error)
    await updateExportJob(db, exportJobId, {
      status: 'failed',
      error: message,
      completedAt: new Date(),
    })
    await publishExportJob(organizationId, { exportJobId, kind: 'finished', status: 'failed' })
    logger.error('Export failed', { exportJobId, error: message })
    throw error
  }
}

/**
 * Fetch field values for a page of records. `batchGetValues` caps field references
 * at 50, so wide views are fetched in chunks (same page re-queried per chunk) and
 * merged into one flat result array.
 */
async function fetchValues(
  fvs: FieldValueService,
  recordIds: RecordId[],
  fieldRefs: FieldReference[]
): Promise<TypedFieldValueResult[]> {
  if (fieldRefs.length <= FIELD_REF_CHUNK) {
    const { values } = await fvs.batchGetValues({ recordIds, fieldReferences: fieldRefs })
    return values
  }

  const all: TypedFieldValueResult[] = []
  for (let i = 0; i < fieldRefs.length; i += FIELD_REF_CHUNK) {
    const chunk = fieldRefs.slice(i, i + FIELD_REF_CHUNK)
    const { values } = await fvs.batchGetValues({ recordIds, fieldReferences: chunk })
    all.push(...values)
  }
  return all
}

/**
 * Resolve relation display names for a page. Collects every related RecordId from
 * this page's relationship values, skips ones already cached, and fetches the rest
 * in chunks via `handler.getByIds` (system + custom entities, cache-backed),
 * merging names into the job-level `nameCache`.
 */
async function hydrateRelationNames(
  handler: UnifiedCrudHandler,
  results: TypedFieldValueResult[],
  nameCache: Map<RecordId, string>
): Promise<void> {
  const needed = new Set<RecordId>()
  for (const result of results) {
    for (const id of extractRelationRecordIds(result)) {
      if (!nameCache.has(id)) needed.add(id)
    }
  }
  if (needed.size === 0) return

  const ids = [...needed]
  for (let i = 0; i < ids.length; i += NAME_CHUNK) {
    const chunk = ids.slice(i, i + NAME_CHUNK)
    const resolved = await handler.getByIds(chunk)
    for (const [recordId, item] of Object.entries(resolved)) {
      nameCache.set(recordId as RecordId, item.displayName)
    }
  }
}
