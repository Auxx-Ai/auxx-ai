// packages/lib/src/export/job/create-job.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { ConditionGroup } from '../../conditions/types'
import type { ExportColumn, ExportJobFormat, ExportType, PrintConfig } from '../types'

/** Input for creating an export job. Filters/sorting/columns are snapshotted. */
export interface CreateExportJobInput {
  organizationId: string
  userId: string
  entityDefinitionId: string
  exportType: ExportType
  columns: ExportColumn[]
  tableId?: string
  viewId?: string
  filters?: ConditionGroup[]
  sorting?: Array<{ id: string; desc: boolean }>
  fileName?: string
  /** Output format — `'csv'` (default) or `'pdf'` (a print run, see `printConfig`). */
  format?: ExportJobFormat
  /** Print-run config snapshot — required when `format` is `'pdf'`. */
  printConfig?: PrintConfig
  /** `exportType: 'selection'` — frozen RecordId list, ordered as selected. */
  recordIds?: string[]
}

/**
 * Create a new export job in `pending` status.
 *
 * @param db - Database instance
 * @param input - Job creation input (snapshot of the view)
 * @returns The created job id
 */
export async function createExportJob(
  db: Database,
  input: CreateExportJobInput
): Promise<{ id: string }> {
  const [job] = await db
    .insert(schema.ExportJob)
    .values({
      organizationId: input.organizationId,
      createdById: input.userId,
      entityDefinitionId: input.entityDefinitionId,
      exportType: input.exportType,
      columns: input.columns,
      tableId: input.tableId,
      viewId: input.viewId,
      filters: input.filters,
      sorting: input.sorting,
      fileName: input.fileName,
      format: input.format ?? 'csv',
      printConfig: input.printConfig,
      recordIds: input.recordIds,
      status: 'pending',
      updatedAt: new Date(),
    })
    .returning({ id: schema.ExportJob.id })

  if (!job) {
    throw new Error('Failed to create export job')
  }

  return { id: job.id }
}
