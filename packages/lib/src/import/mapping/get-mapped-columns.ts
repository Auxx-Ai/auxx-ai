// packages/lib/src/import/mapping/get-mapped-columns.ts

import { eq, and, asc, sql } from 'drizzle-orm'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'

/**
 * Input for getting mapped columns with stats.
 */
export interface GetMappedColumnsInput {
  jobId: string
  organizationId: string
}

/**
 * Mapped column with resolution statistics.
 */
export interface MappedColumnWithStats {
  columnIndex: number
  columnName: string
  targetFieldKey: string | null
  uniqueCount: number
  errorCount: number
  warningCount: number
}

/**
 * Get all mapped columns for a job with their resolution statistics.
 * Combines job/mapping/property queries into efficient operations.
 *
 * @param db - Database instance
 * @param input - Job ID and organization ID for scoping
 * @returns Array of mapped columns with stats, or null if job not found
 */
export async function getMappedColumnsWithStats(
  db: Database,
  input: GetMappedColumnsInput
): Promise<MappedColumnWithStats[] | null> {
  const { jobId, organizationId } = input

  // Get job with mapping and properties in single query
  const job = await db.query.ImportJob.findFirst({
    where: and(
      eq(schema.ImportJob.id, jobId),
      eq(schema.ImportJob.organizationId, organizationId)
    ),
    with: {
      importMapping: {
        with: {
          properties: {
            orderBy: asc(schema.ImportMappingProperty.sourceColumnIndex),
          },
        },
      },
    },
  })

  if (!job) {
    return null
  }

  // Get mappable properties for column names
  const mappableProps = await db.query.ImportJobMappableProperty.findMany({
    where: eq(schema.ImportJobMappableProperty.importJobId, jobId),
  })
  const mappableByIndex = new Map(mappableProps.map((p) => [p.columnIndex, p]))

  // Filter to non-skipped columns
  const mappedProperties = job.importMapping.properties.filter(
    (p) => p.targetType !== 'skip'
  )

  if (mappedProperties.length === 0) {
    return []
  }

  // Get unique counts for all columns in one query using aggregation
  const columnIndices = mappedProperties.map((p) => p.sourceColumnIndex)
  const uniqueCounts = await db
    .select({
      columnIndex: schema.ImportJobRawData.columnIndex,
      uniqueCount: sql<number>`count(distinct ${schema.ImportJobRawData.valueHash})`.as('unique_count'),
    })
    .from(schema.ImportJobRawData)
    .where(
      and(
        eq(schema.ImportJobRawData.importJobId, jobId),
        sql`${schema.ImportJobRawData.columnIndex} IN (${sql.raw(columnIndices.join(','))})`
      )
    )
    .groupBy(schema.ImportJobRawData.columnIndex)

  const countByColumn = new Map(uniqueCounts.map((r) => [r.columnIndex, r.uniqueCount]))

  // Get job properties for error counts
  const mappingPropertyIds = mappedProperties.map((p) => p.id)
  const jobProperties = await db.query.ImportJobProperty.findMany({
    where: and(
      eq(schema.ImportJobProperty.importJobId, jobId),
      sql`${schema.ImportJobProperty.importMappingPropertyId} IN (${sql.raw(mappingPropertyIds.map((id) => `'${id}'`).join(','))})`
    ),
  })
  const errorByPropertyId = new Map(jobProperties.map((p) => [p.importMappingPropertyId, p.errorCount ?? 0]))

  // Build result
  return mappedProperties.map((prop) => {
    const mappable = mappableByIndex.get(prop.sourceColumnIndex)
    return {
      columnIndex: prop.sourceColumnIndex,
      columnName: mappable?.visibleName ?? `Column ${prop.sourceColumnIndex}`,
      targetFieldKey: prop.targetFieldKey,
      uniqueCount: countByColumn.get(prop.sourceColumnIndex) ?? 0,
      errorCount: errorByPropertyId.get(prop.id) ?? 0,
      warningCount: 0, // TODO: track warnings separately if needed
    }
  })
}
