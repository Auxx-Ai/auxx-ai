// packages/lib/src/import/mapping/save-mapping-property.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { SelectOption } from '@auxx/types/custom-field'
import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { ConflictError } from '../../errors'

/** Relation configuration for a mapping */
export interface RelationConfig {
  relatedEntityDefinitionId: string
  relationshipType: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
  matchField?: string
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
  options?: SelectOption[]
}

/** Minimal column shape for duplicate-target validation */
export interface MappedColumnRef {
  sourceColumnIndex: number
  sourceColumnName?: string | null
  targetFieldKey: string | null
}

/**
 * Reject a second column mapped to the same target field. Two columns feeding
 * one field used to be a SILENT last-mapping-wins drop in `buildRecordData` —
 * the earlier column's data vanished without a trace. Multi-column → one-field
 * mapping is not a feature; it is a validation error at mapping time.
 *
 * @throws ConflictError naming the already-mapped column
 */
export function assertNoDuplicateTargetMapping(
  existing: MappedColumnRef[],
  input: { columnIndex: number; targetFieldKey: string | null }
): void {
  if (!input.targetFieldKey) return
  const duplicate = existing.find(
    (m) => m.sourceColumnIndex !== input.columnIndex && m.targetFieldKey === input.targetFieldKey
  )
  if (duplicate) {
    const columnLabel = duplicate.sourceColumnName ?? `Column ${duplicate.sourceColumnIndex + 1}`
    throw new ConflictError(
      `"${columnLabel}" is already mapped to this field. Unmap it first — two columns cannot feed one field.`
    )
  }
}

/**
 * Save a column mapping property.
 * Also resets allowPlanGeneration since mappings changed.
 * Rejects mapping a second column to a field another column already targets.
 *
 * @param db - Database instance
 * @param input - Mapping input
 */
export async function saveMappingProperty(db: Database, input: SaveMappingInput): Promise<void> {
  // Duplicate-target guard: two columns must never feed one field.
  if (input.targetFieldKey) {
    const existing = await db
      .select({
        sourceColumnIndex: schema.ImportMappingProperty.sourceColumnIndex,
        sourceColumnName: schema.ImportMappingProperty.sourceColumnName,
        targetFieldKey: schema.ImportMappingProperty.targetFieldKey,
      })
      .from(schema.ImportMappingProperty)
      .where(
        and(
          eq(schema.ImportMappingProperty.importMappingId, input.mappingId),
          ne(schema.ImportMappingProperty.sourceColumnIndex, input.columnIndex),
          isNotNull(schema.ImportMappingProperty.targetFieldKey)
        )
      )
    assertNoDuplicateTargetMapping(existing, input)
  }

  // Build resolution config if we have options or relation data
  let resolutionConfig: string | null = null
  if (input.matchField || input.relationConfig || input.options) {
    resolutionConfig = JSON.stringify({
      options: input.options,
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
    options?: SelectOption[]
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
    // Build resolutionConfig with options if present
    const resolutionConfig = mapping.options ? JSON.stringify({ options: mapping.options }) : null

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
