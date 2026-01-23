// packages/lib/src/field-values/display-field-service.ts

import { database, schema, type Database } from '@auxx/database'
import { eq, and, sql } from 'drizzle-orm'
import {
  batchUpdateDisplayValues,
  clearDisplayValues,
} from '@auxx/services/entity-instances'
import { formatToDisplayValue } from './formatter'
import {
  type DisplayFieldType,
  type RecalculateDisplayFieldResult,
  DISPLAY_FIELD_CONFIG,
} from './display-field-types'
import { ResourceRegistryService } from '../resources/registry/resource-registry-service'
import { FieldValueService } from './field-value-service'
import { toRecordIds, getInstanceId } from '../resources/resource-id'
import type { ResourceField } from '../resources/registry/field-types'
import type { CustomResource } from '../resources/registry/types'
import type { TypedFieldValue } from '@auxx/types'
import { toResourceFieldId, getFieldId } from '@auxx/types/field'

const BATCH_SIZE = 100

/**
 * Service for managing display field propagation.
 * Handles recalculating denormalized display values on EntityInstance
 * when EntityDefinition display field pointers change.
 */
export class DisplayFieldService {
  private db: Database
  private registryService: ResourceRegistryService
  private fieldValueService: FieldValueService

  constructor(
    private readonly organizationId: string,
    db: Database = database
  ) {
    this.db = db
    this.registryService = new ResourceRegistryService(organizationId, db)
    this.fieldValueService = new FieldValueService(
      organizationId,
      undefined,
      db,
      this.registryService
    )
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

    // 1. Get full resource with fields from registry
    const resource = await this.registryService.getById(entityDefinitionId)

    if (!resource || resource.type !== 'custom') {
      throw new Error(`Entity definition not found: ${entityDefinitionId}`)
    }

    // 2. Get the display field ID and full field definition
    const displayFieldId = this.getDisplayFieldId(resource, displayFieldType)
    const field = displayFieldId
      ? resource.fields.find((f) => f.id === displayFieldId)
      : null

    // 3. If no field configured, clear all values
    if (!displayFieldId || !field) {
      await clearDisplayValues({
        entityDefinitionId,
        organizationId: this.organizationId,
        column: config.instanceColumn,
      })

      // Update searchText when primary or secondary is cleared
      if (displayFieldType === 'primary' || displayFieldType === 'secondary') {
        await this.updateSearchTextForEntityDefinition(entityDefinitionId)
      }

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

    // 4. Process instances in batches
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

      // 5. Use FieldValueService.batchGetValues() - no more raw rows!
      const batchResult = await this.fieldValueService.batchGetValues({
        recordIds: toRecordIds(entityDefinitionId, instanceIds),
        fieldReferences: [toResourceFieldId(entityDefinitionId, displayFieldId)],
      })

      // Group by entityId for easy lookup
      // Extract instanceId from RecordId for local Map lookup
      const valuesByEntity = new Map<string, TypedFieldValue | TypedFieldValue[]>()
      for (const result of batchResult.values) {
        if (result.value) {
          valuesByEntity.set(getInstanceId(result.recordId), result.value)
        }
      }

      // 6. Compute display values using properly typed field
      const updates = new Map<string, string | null>()
      for (const instanceId of instanceIds) {
        const typedValue = valuesByEntity.get(instanceId) ?? null
        const displayValue = this.computeDisplayValue(typedValue, field, displayFieldType)
        updates.set(instanceId, displayValue)
      }

      // 7. Batch update
      const result = await batchUpdateDisplayValues({
        organizationId: this.organizationId,
        updates,
        column: config.instanceColumn,
      })

      if (result.isOk()) updated += result.value.updated
      processed += instanceIds.length

      if (instances.length < BATCH_SIZE) break
    }

    // Update searchText for all instances when primary or secondary display field changes
    if (displayFieldType === 'primary' || displayFieldType === 'secondary') {
      await this.updateSearchTextForEntityDefinition(entityDefinitionId)
    }

    return { displayFieldType, processed, updated }
  }

  /**
   * Update searchText for all instances of an entity definition.
   * Called after batch recalculating primary or secondary display fields.
   */
  private async updateSearchTextForEntityDefinition(entityDefinitionId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE "EntityInstance"
      SET "searchText" = TRIM(CONCAT_WS(' ', "displayName", "secondaryDisplayValue"))
      WHERE "entityDefinitionId" = ${entityDefinitionId}
        AND "organizationId" = ${this.organizationId}
    `)
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
   * Get the field ID for a display field type from CustomResource.
   */
  private getDisplayFieldId(
    resource: CustomResource,
    displayFieldType: DisplayFieldType
  ): string | null {
    switch (displayFieldType) {
      case 'primary':
        return resource.display.primaryDisplayField?.id ?? null
      case 'secondary':
        return resource.display.secondaryDisplayField?.id ?? null
      case 'avatar':
        return resource.display.avatarField?.id ?? null
    }
  }

  /**
   * Compute display value from already-typed field values.
   * No more raw rows - FieldValueService handles the conversion.
   */
  private computeDisplayValue(
    typedValue: TypedFieldValue | TypedFieldValue[] | null,
    field: ResourceField,
    displayFieldType: DisplayFieldType
  ): string | null {
    if (!typedValue) return null

    // For avatar fields, extract URL directly
    if (displayFieldType === 'avatar') {
      const single = Array.isArray(typedValue) ? typedValue[0] : typedValue
      if (!single) return null

      if (single.type === 'text') {
        return single.value || null
      }
      if (single.type === 'json') {
        const json = single.value as Record<string, unknown>
        if (typeof json?.url === 'string') return json.url
      }
      return null
    }

    // Use fieldType from ResourceField (properly typed FieldType enum)
    const fieldType = field.fieldType ?? 'TEXT'

    // Use centralized formatter with properly typed options
    const displayValue = formatToDisplayValue(typedValue, fieldType, field.options)

    return typeof displayValue === 'string' ? displayValue : null
  }
}
