// packages/lib/src/import/job/create-job.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'

/** Input for creating an import job */
export interface CreateJobInput {
  organizationId: string
  userId: string
  fileName: string
  targetTable: string
  headers: Array<{ index: number; name: string }>
  columnCount: number
  rowCount: number
}

/** Result of creating an import job */
export interface CreateJobResult {
  jobId: string
  mappingId: string
}

/**
 * Create a new import job with associated mapping and properties.
 *
 * @param db - Database instance
 * @param input - Job creation input
 * @returns Created job and mapping IDs
 */
export async function createImportJob(
  db: Database,
  input: CreateJobInput
): Promise<CreateJobResult> {
  const now = new Date()

  // Create the import mapping template first
  const [mapping] = await db
    .insert(schema.ImportMapping)
    .values({
      organizationId: input.organizationId,
      targetTable: input.relatedEntityDefinitionId,
      title: `Import from ${input.fileName}`,
      sourceType: 'csv',
      defaultStrategy: 'create',
      createdById: input.userId,
      updatedAt: now,
    })
    .returning()

  if (!mapping) {
    throw new Error('Failed to create mapping')
  }

  // Calculate total chunks (1000 rows per chunk)
  const totalChunks = Math.ceil(input.rowCount / 1000)

  // Create the import job
  const [job] = await db
    .insert(schema.ImportJob)
    .values({
      organizationId: input.organizationId,
      importMappingId: mapping.id,
      sourceFileName: input.fileName,
      columnCount: input.columnCount,
      rowCount: input.rowCount,
      totalChunks,
      receivedChunks: 0,
      status: 'uploading',
      createdById: input.userId,
      updatedAt: now,
    })
    .returning()

  if (!job) {
    throw new Error('Failed to create job')
  }

  // Create mappable properties for each column header
  const mappableProperties = input.headers.map((header) => ({
    importJobId: job.id,
    columnIndex: header.index,
    visibleName: header.name,
  }))

  await db.insert(schema.ImportJobMappableProperty).values(mappableProperties)

  // Create mapping properties (initially set to skip)
  const mappingProperties = input.headers.map((header) => ({
    importMappingId: mapping.id,
    sourceColumnIndex: header.index,
    sourceColumnName: header.name,
    targetType: 'skip' as const,
    resolutionType: 'text:value',
    updatedAt: now,
  }))

  await db.insert(schema.ImportMappingProperty).values(mappingProperties)

  return { jobId: job.id, mappingId: mapping.id }
}
