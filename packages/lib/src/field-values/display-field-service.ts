// packages/lib/src/field-values/display-field-service.ts

import { database, schema, type Database } from '@auxx/database'
import { eq, and, gt } from 'drizzle-orm'
import {
  batchUpdateDisplayValues,
  clearDisplayValues,
} from '@auxx/services/entity-instances'
import { getDisplayValue, rowToTypedValue, type FieldValueRow } from './value-converter'
import {
  type DisplayFieldType,
  type RecalculateDisplayFieldResult,
  DISPLAY_FIELD_CONFIG,
} from './display-field-types'
import type { SelectOption } from '@auxx/types'

const BATCH_SIZE = 100

/**
 * Service for managing display field propagation.
 * Handles recalculating denormalized display values on EntityInstance
 * when EntityDefinition display field pointers change.
 */
export class DisplayFieldService {
  private db: Database

  constructor(
    private readonly organizationId: string,
    db: Database = database
  ) {
    this.db = db
  }

  /**
   * Recalculate a display field for all instances of an entity definition.
   * Modular design: works for primary, secondary, or avatar fields.
   */
  async recalculateDisplayField(
    entityDefinitionId: string,
    displayFieldType: DisplayFieldType
  ): Promise<RecalculateDisplayFieldResult> {
    const config = DISPLAY_FIELD_CONFIG[displayFieldType]

    // 1. Get entity definition with the relevant display field relation
    const entityDefWithField = await this.db.query.EntityDefinition.findFirst({
      where: (ed, { eq: eqOp, and: andOp }) =>
        andOp(eqOp(ed.id, entityDefinitionId), eqOp(ed.organizationId, this.organizationId)),
      with: {
        ...(displayFieldType === 'primary' && { primaryDisplayField: true }),
        ...(displayFieldType === 'secondary' && { secondaryDisplayField: true }),
        ...(displayFieldType === 'avatar' && { avatarField: true }),
      },
    })

    if (!entityDefWithField) {
      throw new Error(`Entity definition not found: ${entityDefinitionId}`)
    }

    const fieldId = entityDefWithField[config.definitionColumn] as string | null
    const field = this.getFieldFromEntityDef(entityDefWithField, displayFieldType)

    // 2. If no field configured, clear all values
    if (!fieldId || !field) {
      await clearDisplayValues({
        entityDefinitionId,
        organizationId: this.organizationId,
        column: config.instanceColumn,
      })

      const count = await this.db
        .select({ id: schema.EntityInstance.id })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
            eq(schema.EntityInstance.organizationId, this.organizationId)
          )
        )

      return { displayFieldType, processed: count.length, updated: count.length }
    }

    let processed = 0
    let updated = 0
    let cursor: string | undefined

    // 3. Process instances in batches
    while (true) {
      const instances = await this.db.query.EntityInstance.findMany({
        where: (ei, { eq: eqOp, and: andOp, gt: gtOp }) => {
          const conditions = [
            eqOp(ei.entityDefinitionId, entityDefinitionId),
            eqOp(ei.organizationId, this.organizationId),
          ]
          if (cursor) conditions.push(gtOp(ei.id, cursor))
          return andOp(...conditions)
        },
        columns: { id: true },
        orderBy: (ei, { asc }) => asc(ei.id),
        limit: BATCH_SIZE,
      })

      if (instances.length === 0) break

      const instanceIds = instances.map((i) => i.id)
      cursor = instanceIds[instanceIds.length - 1]

      // 4. Get field values for this batch
      const fieldValues = await this.db.query.FieldValue.findMany({
        where: (fv, { eq: eqOp, and: andOp, inArray: inArr }) =>
          andOp(
            inArr(fv.entityId, instanceIds),
            eqOp(fv.fieldId, fieldId),
            eqOp(fv.organizationId, this.organizationId)
          ),
        orderBy: (fv, { asc }) => asc(fv.sortKey),
      })

      // Group by entityId
      const valuesByEntity = new Map<string, typeof fieldValues>()
      for (const fv of fieldValues) {
        const existing = valuesByEntity.get(fv.entityId) ?? []
        existing.push(fv)
        valuesByEntity.set(fv.entityId, existing)
      }

      // 5. Compute display values using existing utilities
      const updates = new Map<string, string | null>()
      for (const instanceId of instanceIds) {
        const rows = valuesByEntity.get(instanceId) ?? []
        const displayValue = this.computeDisplayValue(rows as FieldValueRow[], field, displayFieldType)
        updates.set(instanceId, displayValue)
      }

      // 6. Batch update
      const result = await batchUpdateDisplayValues({
        organizationId: this.organizationId,
        updates,
        column: config.instanceColumn,
      })

      if (result.isOk()) updated += result.value.updated
      processed += instanceIds.length

      if (instances.length < BATCH_SIZE) break
    }

    return { displayFieldType, processed, updated }
  }

  /**
   * Recalculate multiple display fields at once.
   */
  async recalculateDisplayFields(
    entityDefinitionId: string,
    displayFieldTypes: DisplayFieldType[]
  ): Promise<RecalculateDisplayFieldResult[]> {
    const results: RecalculateDisplayFieldResult[] = []
    for (const displayFieldType of displayFieldTypes) {
      results.push(await this.recalculateDisplayField(entityDefinitionId, displayFieldType))
    }
    return results
  }

  /**
   * Extract the field definition from entity def based on display field type.
   */
  private getFieldFromEntityDef(
    entityDef: Record<string, unknown>,
    displayFieldType: DisplayFieldType
  ): { type: string; options: unknown } | null {
    switch (displayFieldType) {
      case 'primary':
        return entityDef.primaryDisplayField as { type: string; options: unknown } | null
      case 'secondary':
        return entityDef.secondaryDisplayField as { type: string; options: unknown } | null
      case 'avatar':
        return entityDef.avatarField as { type: string; options: unknown } | null
    }
  }

  /**
   * Compute display value from field value rows.
   * Uses existing rowToTypedValue and getDisplayValue utilities.
   */
  private computeDisplayValue(
    rows: FieldValueRow[],
    field: { type: string; options: unknown },
    displayFieldType: DisplayFieldType
  ): string | null {
    if (rows.length === 0) return null

    // For avatar fields, extract URL directly
    if (displayFieldType === 'avatar') {
      const row = rows[0]!
      if (row.valueText) return row.valueText
      if (row.valueJson) {
        const json = row.valueJson as Record<string, unknown>
        if (typeof json.url === 'string') return json.url
      }
      return null
    }

    // Convert rows to TypedFieldValue using existing utility
    const typedValues = rows.map((row) => rowToTypedValue(row, field.type))

    // Use existing getDisplayValue for consistency
    const displayValue = getDisplayValue(
      typedValues.length === 1 ? typedValues[0]! : typedValues,
      field.options as SelectOption[] | undefined
    )

    return displayValue || null
  }
}
