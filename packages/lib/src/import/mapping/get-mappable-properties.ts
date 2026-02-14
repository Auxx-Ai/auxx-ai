// packages/lib/src/import/mapping/get-mappable-properties.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'

/** Mappable property with sample values and mapping info */
export interface MappablePropertyWithSamples {
  id: string
  columnIndex: number
  visibleName: string
  sampleValues: string[]
  targetType: string
  targetFieldKey: string | null
  customFieldId: string | null
  resolutionType: string
  matchField: string | null
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

      // Parse resolution config for matchField
      let matchField: string | null = null
      if (savedMapping?.resolutionConfig) {
        try {
          const config = JSON.parse(savedMapping.resolutionConfig) as {
            relationConfig?: { matchField?: string }
          }
          matchField = config.relationConfig?.matchField ?? null
        } catch {
          // Invalid JSON, ignore
        }
      }

      return {
        id: prop.id,
        columnIndex: prop.columnIndex,
        visibleName: prop.visibleName,
        sampleValues: samples.map((s) => s.value),
        targetType: savedMapping?.targetType ?? 'skip',
        targetFieldKey: savedMapping?.targetFieldKey ?? null,
        customFieldId: savedMapping?.customFieldId ?? null,
        resolutionType: savedMapping?.resolutionType ?? 'text:value',
        matchField,
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
