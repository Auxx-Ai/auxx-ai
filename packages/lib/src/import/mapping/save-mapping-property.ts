// packages/lib/src/import/mapping/save-mapping-property.ts

import { eq, and } from 'drizzle-orm'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'

/** Relation configuration for a mapping */
export interface RelationConfig {
  relatedEntityDefinitionId: string
  relationshipType: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
  matchField?: string
}

/** Enum value option */
export interface EnumValue {
  dbValue: string
  label: string
}

/** Input for saving a column mapping */
export interface SaveMappingInput {
  mappingId: string
  columnIndex: number
  targetFieldKey: string | null
  customFieldId: string | null
  resolutionType: string
  matchField?: string
  relationConfig?: RelationConfig
  enumValues?: EnumValue[]
}

/**
 * Save a column mapping property.
 * Also resets allowPlanGeneration since mappings changed.
 *
 * @param db - Database instance
 * @param input - Mapping input
 */
export async function saveMappingProperty(
  db: Database,
  input: SaveMappingInput
): Promise<void> {
  // Build resolution config if we have enum or relation data
  let resolutionConfig: string | null = null
  if (input.matchField || input.relationConfig || input.enumValues) {
    resolutionConfig = JSON.stringify({
      enumValues: input.enumValues,
      relationConfig: input.relationConfig
        ? {
            ...input.relationConfig,
            matchField: input.matchField,
          }
        : undefined,
    })
  }

  // Update the mapping property
  await db
    .update(schema.ImportMappingProperty)
    .set({
      targetFieldKey: input.targetFieldKey,
      customFieldId: input.customFieldId,
      targetType: input.targetFieldKey ? 'particle' : 'skip',
      resolutionType: input.resolutionType,
      resolutionConfig,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.ImportMappingProperty.importMappingId, input.mappingId),
        eq(schema.ImportMappingProperty.sourceColumnIndex, input.columnIndex)
      )
    )

  // Reset allowPlanGeneration since mappings changed - requires re-resolution
  await db
    .update(schema.ImportJob)
    .set({ allowPlanGeneration: false, updatedAt: new Date() })
    .where(eq(schema.ImportJob.importMappingId, input.mappingId))
}

/** Input for batch updating mappings from auto-map results */
export interface AutoMapUpdateInput {
  mappingId: string
  mappings: Array<{
    columnIndex: number
    matchedFieldKey: string | null
    customFieldId: string | null
    resolutionType: string
    enumValues?: EnumValue[]
  }>
}

/**
 * Batch update mapping properties from auto-map results.
 * Also resets allowPlanGeneration since mappings changed.
 *
 * @param db - Database instance
 * @param input - Auto-map update input
 */
export async function batchUpdateMappingsFromAutoMap(
  db: Database,
  input: AutoMapUpdateInput
): Promise<void> {
  const now = new Date()

  for (const mapping of input.mappings) {
    // Build resolutionConfig with enumValues if present
    const resolutionConfig = mapping.enumValues
      ? JSON.stringify({ enumValues: mapping.enumValues })
      : null

    await db
      .update(schema.ImportMappingProperty)
      .set({
        targetFieldKey: mapping.matchedFieldKey,
        customFieldId: mapping.customFieldId,
        targetType: mapping.matchedFieldKey ? 'particle' : 'skip',
        resolutionType: mapping.resolutionType,
        resolutionConfig,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.ImportMappingProperty.importMappingId, input.mappingId),
          eq(schema.ImportMappingProperty.sourceColumnIndex, mapping.columnIndex)
        )
      )
  }

  // Reset allowPlanGeneration since mappings changed - requires re-resolution
  await db
    .update(schema.ImportJob)
    .set({ allowPlanGeneration: false, updatedAt: now })
    .where(eq(schema.ImportJob.importMappingId, input.mappingId))
}
