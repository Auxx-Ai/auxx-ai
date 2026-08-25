// packages/lib/src/import/mapping/get-mapped-columns.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'

/**
 * Input for getting mapped columns with stats.
 */
export interface GetMappedColumnsInput {
  jobId: string
  organizationId: string
}

/**
 * Mapped column with resolution statistics.
 *
 * Both counts are DISTINCT VALUES, not rows — the review step groups distinct
 * values, so "14 errors" means fourteen categories, not fourteen cells.
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
    where: and(eq(schema.ImportJob.id, jobId), eq(schema.ImportJob.organizationId, organizationId)),
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
  const mappedProperties = job.importMapping.properties.filter((p) => p.targetType !== 'skip')

  if (mappedProperties.length === 0) {
    return []
  }

  // Get unique counts for all columns in one query using aggregation
  const columnIndices = mappedProperties.map((p) => p.sourceColumnIndex)
  const uniqueCounts = await db
    .select({
      columnIndex: schema.ImportJobRawData.columnIndex,
      uniqueCount: sql<number>`count(distinct ${schema.ImportJobRawData.valueHash})`.as(
        'unique_count'
      ),
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
  const errorByPropertyId = new Map(
    jobProperties.map((p) => [p.importMappingPropertyId, p.errorCount ?? 0])
  )

  // Warnings are NOT counted on `ImportJobProperty` — only `errorCount` is
  // stored there — and the review step groups values on `warning`, so a
  // hardcoded 0 made that group's headline permanently disagree with the group
  // it summarised. Counted straight off the resolutions instead; the
  // `(importJobPropertyId, status)` index makes it a cheap grouped count, and
  // nothing has to be kept in sync with a second writer.
  const warningByPropertyId = new Map<string, number>()
  if (jobProperties.length > 0) {
    const warningCounts = await db
      .select({
        importJobPropertyId: schema.ImportValueResolution.importJobPropertyId,
        warningCount: sql<number>`count(*)`.as('warning_count'),
      })
      .from(schema.ImportValueResolution)
      .where(
        and(
          inArray(
            schema.ImportValueResolution.importJobPropertyId,
            jobProperties.map((p) => p.id)
          ),
          eq(schema.ImportValueResolution.status, 'warning')
        )
      )
      .groupBy(schema.ImportValueResolution.importJobPropertyId)

    const jobPropertyIdByMappingPropertyId = new Map(
      jobProperties.map((p) => [p.id, p.importMappingPropertyId])
    )
    for (const row of warningCounts) {
      const mappingPropertyId = jobPropertyIdByMappingPropertyId.get(row.importJobPropertyId)
      if (mappingPropertyId) warningByPropertyId.set(mappingPropertyId, Number(row.warningCount))
    }
  }

  // Build result
  return mappedProperties.map((prop) => {
    const mappable = mappableByIndex.get(prop.sourceColumnIndex)
    return {
      columnIndex: prop.sourceColumnIndex,
      columnName: mappable?.visibleName ?? `Column ${prop.sourceColumnIndex}`,
      targetFieldKey: prop.targetFieldKey,
      uniqueCount: countByColumn.get(prop.sourceColumnIndex) ?? 0,
      errorCount: errorByPropertyId.get(prop.id) ?? 0,
      warningCount: warningByPropertyId.get(prop.id) ?? 0,
    }
  })
}
