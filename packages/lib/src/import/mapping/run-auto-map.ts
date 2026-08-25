// packages/lib/src/import/mapping/run-auto-map.ts

import type { Database } from '@auxx/database'
import { getCachedResource } from '../../cache'
import { getFieldOutputKey } from '../../resources/registry/field-types'
import { getNaturalKeyFields } from '../../resources/registry/field-utils'
import type { Resource } from '../../resources/registry/types'
import { type ColumnHeaderWithSamples, orchestrateAutoMap } from '../fields/auto-map-orchestrator'
import { getImportableFields } from '../fields/get-importable-fields'
import { buildRelationColumnPolicy } from '../resolution/relation-policy'
import { getMappablePropertiesWithSamples } from './get-mappable-properties'
import { batchUpdateMappingsFromAutoMap, type RelationConfig } from './save-mapping-property'

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
  const {
    jobId,
    importMappingId,
    entityDefinitionId,
    organizationId,
    userId,
    strategy = 'auto',
  } = input

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

  // 5. Enrich mappings with customFieldId, options and, for relation columns,
  //    the full resolution POLICY.
  //
  // Defect E, the half that lives outside the resolver. Auto-map used to
  // persist a relation column with no `relationConfig` and no `matchField`, so
  // the resolver fell back to `primaryDisplayField.name`, a human LABEL
  // (`Company Name`) where a field KEY (`name`) was required, and every value
  // reported "No match found". Where the relation is `required` (both of
  // `vendor_part`'s are) the whole row failed. Clicking "Auto-map Columns" was
  // the only action needed to reach it.
  //
  // Resolving the policy HERE covers both arms: the AI mapper and the pure
  // string-matching fallback, neither of which can reach the org cache itself.
  const mappingsWithFieldData = await Promise.all(
    mappingResult.mappings.map(async (m) => {
      const field = fields.find((f) => f.key === m.matchedFieldKey)

      let relationConfig: RelationConfig | undefined
      let resolutionType = m.resolutionType
      if (field?.isRelation && field.relationConfig) {
        const targetResource = await getCachedResource(
          organizationId,
          field.relationConfig.relatedEntityDefinitionId
        )
        if (targetResource) {
          // Anything the AI arm already settled on is passed through as an
          // OVERRIDE rather than recomputed, `buildRelationColumnPolicy` stays
          // the single authority, and the AI's choice of match field survives.
          // The fallback string-matching arm supplies none of these, so it gets
          // the derived defaults.
          const policy = buildRelationColumnPolicy(
            targetResource,
            field.relationConfig.relationshipType,
            { matchField: m.matchField, onNoMatch: m.onNoMatch, linkMode: m.linkMode }
          )
          relationConfig = {
            relatedEntityDefinitionId: field.relationConfig.relatedEntityDefinitionId,
            relationshipType: field.relationConfig.relationshipType,
            matchField: policy.matchField,
            onNoMatch: policy.onNoMatch,
            linkMode: policy.linkMode,
          }
          // The policy decides the resolution type, `relation:match` was
          // hardcoded for every relation regardless of the on-no-match choice.
          resolutionType = policy.resolutionType
        }
      }

      return {
        ...m,
        resolutionType,
        customFieldId: field?.id ?? null,
        options: field?.options,
        relationConfig,
      }
    })
  )

  // 6. Save auto-mapped results to database.
  //
  // `fields` is already in picker order, the tier-1 identifier group first with
  // Record ID last inside it, so the first entry auto-map actually mapped is
  // the right column to default the identity flag onto. Composite-only (relation)
  // identifiers are excluded: a relation is never the LONE match key.
  const preferredIdentifierFieldKeys = fields
    .filter((f) => f.identifierTier === 1 && !f.identifierCompositeOnly)
    .map((f) => f.key)

  // A declared NATURAL KEY outranks the single-column pick, when every one of
  // its legs was mapped. `vendor_part` has no lone identifier at all — a
  // supplier price list keyed on `(part, supplier)` is the only way it can
  // update rather than duplicate — and a key the user has to assemble by hand,
  // two toggles deep in a picker, is a key nobody sets.
  //
  // Read off the resource, never off an entity type: `vendor_part` is the first
  // declarer, not a special case, and any resource that declares one gets this.
  const naturalKeyFieldKeys = getNaturalKeyFields(resource).map(getFieldOutputKey)

  await batchUpdateMappingsFromAutoMap(db, {
    mappingId: importMappingId,
    mappings: mappingsWithFieldData,
    preferredIdentifierFieldKeys,
    naturalKeyFieldKeys,
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
