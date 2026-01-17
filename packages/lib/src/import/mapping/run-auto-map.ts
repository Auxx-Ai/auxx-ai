// packages/lib/src/import/mapping/run-auto-map.ts

import type { Database } from '@auxx/database'
import type { Resource } from '../../resources/registry/types'
import { getMappablePropertiesWithSamples } from './get-mappable-properties'
import { batchUpdateMappingsFromAutoMap } from './save-mapping-property'
import {
  orchestrateAutoMap,
  type ColumnHeaderWithSamples,
} from '../fields/auto-map-orchestrator'
import { getImportableFields } from '../fields/get-importable-fields'

/** Auto-map strategy type */
export type AutoMapStrategy = 'ai' | 'fallback' | 'auto'

/** Input for runAutoMap */
export interface RunAutoMapInput {
  jobId: string
  importMappingId: string
  entityDefinitionId: string
  organizationId: string
  userId: string
  /** Auto-map strategy: 'ai' | 'fallback' | 'auto' */
  strategy?: AutoMapStrategy
}

/** Result from runAutoMap */
export interface RunAutoMapResult {
  mappings: Array<{
    columnIndex: number
    targetFieldKey: string | null
    customFieldId: string | null
    resolutionType: string
  }>
  usedAI: boolean
}

/**
 * Run auto-mapping for an import job.
 * Fetches properties and fields, runs orchestrateAutoMap, saves results.
 *
 * @param db - Database instance
 * @param resource - Target resource definition
 * @param input - Auto-map input parameters
 * @returns Auto-map result with mappings
 */
export async function runAutoMap(
  db: Database,
  resource: Resource,
  input: RunAutoMapInput
): Promise<RunAutoMapResult> {
  const { jobId, importMappingId, entityDefinitionId, organizationId, userId, strategy = 'auto' } = input

  // 1. Get mappable properties with samples
  const properties = await getMappablePropertiesWithSamples(db, jobId, importMappingId)

  // 2. Convert to format expected by orchestrateAutoMap
  const headersWithSamples: ColumnHeaderWithSamples[] = properties.map((p) => ({
    index: p.columnIndex,
    name: p.visibleName,
    sampleValues: p.sampleValues,
  }))

  // 3. Get importable fields (include identifiers for id column matching)
  const fields = getImportableFields(resource, { includeIdentifiers: true })

  // 4. Run orchestrated auto-mapping
  const mappingResult = await orchestrateAutoMap(
    db,
    organizationId,
    userId,
    headersWithSamples,
    fields,
    {
      strategy,
      entityDefinitionId,
    }
  )

  // 5. Enrich mappings with customFieldId and enumValues from field definitions
  const mappingsWithFieldData = mappingResult.mappings.map((m) => {
    const field = fields.find((f) => f.key === m.matchedFieldKey)
    return {
      ...m,
      customFieldId: field?.id ?? null,
      enumValues: field?.enumValues,
    }
  })

  // 6. Save auto-mapped results to database
  await batchUpdateMappingsFromAutoMap(db, {
    mappingId: importMappingId,
    mappings: mappingsWithFieldData,
  })

  // 7. Return result for API response
  return {
    mappings: mappingsWithFieldData.map((m) => ({
      columnIndex: m.columnIndex,
      targetFieldKey: m.matchedFieldKey,
      customFieldId: m.customFieldId,
      resolutionType: m.resolutionType,
    })),
    usedAI: mappingResult.usedAI,
  }
}
