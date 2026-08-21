// packages/lib/src/import/mapping/get-mappable-properties.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { MappablePropertyWithSamples } from '../types/mapping'
import { parseResolutionConfig } from './resolution-config'

export type { MappablePropertyWithSamples }

/**
 * Per-column distinct/total counts for a job, in ONE grouped aggregate.
 *
 * Backed by `ImportJobRawData_valueHash_idx`
 * `(importJobId, columnIndex, valueHash)`, the counts come off the index, and
 * one grouped query beats N per-column round trips at mapping time.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @returns Map of columnIndex → { distinct, total }
 */
async function getColumnValueCounts(
  db: Database,
  jobId: string
): Promise<Map<number, { distinct: number; total: number }>> {
  const rows = await db
    .select({
      columnIndex: schema.ImportJobRawData.columnIndex,
      distinct: sql<number>`count(distinct ${schema.ImportJobRawData.valueHash})::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(schema.ImportJobRawData)
    .where(eq(schema.ImportJobRawData.importJobId, jobId))
    .groupBy(schema.ImportJobRawData.columnIndex)

  return new Map(rows.map((r) => [r.columnIndex, { distinct: r.distinct, total: r.total }]))
}

/**
 * Get mappable properties (column headers) for a job with saved mapping data and samples.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @param mappingId - Import mapping ID
 * @returns Array of mappable properties with samples
 */
export async function getMappablePropertiesWithSamples(
  db: Database,
  jobId: string,
  mappingId: string
): Promise<MappablePropertyWithSamples[]> {
  // Get mappable properties (column headers)
  const properties = await db.query.ImportJobMappableProperty.findMany({
    where: eq(schema.ImportJobMappableProperty.importJobId, jobId),
    orderBy: asc(schema.ImportJobMappableProperty.columnIndex),
  })

  // Get saved mapping properties
  const mappingProperties = await db.query.ImportMappingProperty.findMany({
    where: eq(schema.ImportMappingProperty.importMappingId, mappingId),
  })

  // Create a map for quick lookup by column index
  const mappingByIndex = new Map(mappingProperties.map((mp) => [mp.sourceColumnIndex, mp]))

  const valueCounts = await getColumnValueCounts(db, jobId)

  // Combine column headers with saved mappings and sample values
  const propertiesWithMappings = await Promise.all(
    properties.map(async (prop) => {
      // Get sample values
      const samples = await db
        .selectDistinct({ value: schema.ImportJobRawData.value })
        .from(schema.ImportJobRawData)
        .where(
          and(
            eq(schema.ImportJobRawData.importJobId, jobId),
            eq(schema.ImportJobRawData.columnIndex, prop.columnIndex)
          )
        )
        .limit(5)

      // Get saved mapping for this column
      const savedMapping = mappingByIndex.get(prop.columnIndex)
      const config = parseResolutionConfig(savedMapping?.resolutionConfig)
      const counts = valueCounts.get(prop.columnIndex)

      return {
        id: prop.id,
        columnIndex: prop.columnIndex,
        visibleName: prop.visibleName,
        sampleValues: samples.map((s) => s.value),
        targetType: savedMapping?.targetType ?? 'skip',
        targetFieldKey: savedMapping?.targetFieldKey ?? null,
        customFieldId: savedMapping?.customFieldId ?? null,
        resolutionType: savedMapping?.resolutionType ?? 'text:value',
        matchField: config.relationConfig?.matchField ?? null,
        identityRole: config.identityRole ?? null,
        mergeStrategy: config.mergeStrategy ?? null,
        // Same parsed `config`, same row. The router used to re-query
        // `ImportMappingProperty` with this exact `where` and re-parse the same
        // JSON purely to recover these two.
        onNoMatch: config.relationConfig?.onNoMatch ?? null,
        linkMode: config.relationConfig?.linkMode ?? null,
        distinctValueCount: counts?.distinct ?? 0,
        totalValueCount: counts?.total ?? 0,
      }
    })
  )

  return propertiesWithMappings
}

/**
 * Get sample values for multiple columns.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @param columnIndices - Array of column indices
 * @param limit - Max samples per column (default 5)
 * @returns Map of columnIndex to sample values
 */
export async function getColumnSamples(
  db: Database,
  jobId: string,
  columnIndices: number[],
  limit: number = 5
): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>()

  await Promise.all(
    columnIndices.map(async (columnIndex) => {
      const samples = await db
        .selectDistinct({ value: schema.ImportJobRawData.value })
        .from(schema.ImportJobRawData)
        .where(
          and(
            eq(schema.ImportJobRawData.importJobId, jobId),
            eq(schema.ImportJobRawData.columnIndex, columnIndex)
          )
        )
        .limit(limit)

      result.set(
        columnIndex,
        samples.map((s) => s.value)
      )
    })
  )

  return result
}
