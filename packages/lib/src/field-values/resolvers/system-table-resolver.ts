// packages/lib/src/field-values/resolvers/system-table-resolver.ts

import { schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { getValueType, isArrayReturnFieldType, type TypedFieldValue } from '@auxx/types'
import { toActorId } from '@auxx/types/actor'
import { parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import type { FieldOptions } from '../../custom-fields/field-options'
import { RESOURCE_DISPLAY_CONFIG } from '../../resources/registry/display-config'
import { RESOURCE_TABLE_MAP, type TableId } from '../../resources/registry/field-registry'
import { toRecordId } from '../../resources/resource-id'
import type { FieldValueContext } from '../field-value-helpers'
import type { TypedFieldValueResult } from '../types'

/**
 * Descriptor for a system field that maps to a real DB column.
 * Built from the org-scoped cached resource field (not from static registry).
 */
export interface SystemFieldDescriptor {
  /** Static key (e.g., 'subject', 'status') — from cached field.key */
  fieldKey: string
  /** UUID or key — from parseResourceFieldId, used in results */
  fieldId: string
  fieldRef: ResourceFieldId
  fieldType: FieldType
  fieldOptions?: FieldOptions
  /** Guaranteed non-undefined by caller */
  dbColumn: string
  relationship?: FieldOptions['relationship']
}

/**
 * Batch-resolve system resource fields by querying the actual DB table.
 *
 * One query per resource type (not per field). Groups requested fields,
 * builds a single SELECT with all needed columns, and maps column values
 * to TypedFieldValue objects.
 *
 * Handles org scoping per RESOURCE_DISPLAY_CONFIG.
 */
export async function resolveSystemTableFields(
  ctx: FieldValueContext,
  entityDefId: TableId,
  entityIds: string[],
  fields: SystemFieldDescriptor[]
): Promise<TypedFieldValueResult[]> {
  if (entityIds.length === 0 || fields.length === 0) return []

  const tableDef = RESOURCE_TABLE_MAP[entityDefId]
  if (!tableDef) return []

  const table = (schema as any)[tableDef.dbName]
  if (!table) return []

  // Build column selection: { fieldKey: drizzleColumn }
  const selectedColumns: Record<string, any> = {}
  for (const field of fields) {
    const col = table[field.dbColumn]
    if (col) {
      selectedColumns[field.fieldKey] = col
    }
  }

  if (Object.keys(selectedColumns).length === 0) return []

  const rows = await querySystemTable(ctx, entityDefId, table, entityIds, selectedColumns)

  return mapRowsToResults(rows, fields, entityDefId)
}

/**
 * Execute the org-scoped query against a system table.
 */
async function querySystemTable(
  ctx: FieldValueContext,
  entityDefId: TableId,
  table: any,
  entityIds: string[],
  selectedColumns: Record<string, any>
): Promise<Record<string, any>[]> {
  const displayConfig = RESOURCE_DISPLAY_CONFIG[entityDefId]
  const orgStrategy = displayConfig?.orgScopingStrategy ?? 'direct'

  if (orgStrategy === 'join' && displayConfig?.joinScoping) {
    return queryWithJoinScoping(ctx, table, entityIds, selectedColumns, displayConfig.joinScoping)
  }

  // Direct scoping (most tables) or fallback
  const conditions = [inArray(table.id, entityIds)]
  if (table.organizationId) {
    conditions.push(eq(table.organizationId, ctx.organizationId))
  }

  return ctx.db
    .select({ id: table.id, ...selectedColumns })
    .from(table)
    .where(and(...conditions))
}

/**
 * Query with join-based org scoping (e.g., User via OrganizationMember).
 */
async function queryWithJoinScoping(
  ctx: FieldValueContext,
  table: any,
  entityIds: string[],
  selectedColumns: Record<string, any>,
  joinScoping: NonNullable<(typeof RESOURCE_DISPLAY_CONFIG)[TableId]['joinScoping']>
): Promise<Record<string, any>[]> {
  const jt = (schema as any)[joinScoping.joinTable]
  if (!jt) return []

  const joinConditions = [
    inArray(table.id, entityIds),
    eq(jt[joinScoping.joinOrgKey], ctx.organizationId),
  ]

  for (const [key, val] of Object.entries(joinScoping.additionalConditions ?? {})) {
    joinConditions.push(eq(jt[key], val))
  }

  return ctx.db
    .select({ id: table.id, ...selectedColumns })
    .from(table)
    .innerJoin(jt, eq(table[joinScoping.mainTableKey], jt[joinScoping.joinSourceKey]))
    .where(and(...joinConditions))
}

/**
 * Map raw DB rows to TypedFieldValueResult[].
 */
function mapRowsToResults(
  rows: Record<string, any>[],
  fields: SystemFieldDescriptor[],
  entityDefId: TableId
): TypedFieldValueResult[] {
  const results: TypedFieldValueResult[] = []

  for (const row of rows) {
    const entityId = row.id as string
    const recordId = toRecordId(entityDefId, entityId) as RecordId

    for (const field of fields) {
      const rawValue = row[field.fieldKey]
      const typedValue = columnToTypedFieldValue(entityId, field, rawValue)
      if (!typedValue) continue

      const isMulti = isArrayReturnFieldType(
        field.fieldType,
        (field.fieldOptions as any)?.actor
          ? { actor: (field.fieldOptions as any).actor }
          : undefined
      )

      results.push({
        recordId,
        fieldRef: field.fieldRef,
        value: isMulti ? [typedValue] : typedValue,
        fieldType: field.fieldType,
        fieldOptions: field.fieldOptions,
      })
    }
  }

  return results
}

/**
 * Convert a single DB column value to a TypedFieldValue.
 * Returns null for null/undefined values (matches FieldValue behavior: no row = no value).
 */
function columnToTypedFieldValue(
  entityId: string,
  field: SystemFieldDescriptor,
  value: unknown
): TypedFieldValue | null {
  if (value === null || value === undefined) return null

  const valueType = getValueType(field.fieldType)
  const base = {
    id: `system_${entityId}_${field.fieldKey}`,
    entityId,
    fieldId: field.fieldId,
    sortKey: '0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  switch (valueType) {
    case 'text':
      return { ...base, type: 'text', value: String(value) }
    case 'number':
      return { ...base, type: 'number', value: Number(value) }
    case 'boolean':
      return { ...base, type: 'boolean', value: Boolean(value) }
    case 'date':
      return {
        ...base,
        type: 'date',
        value: value instanceof Date ? value.toISOString() : String(value),
      }
    case 'json':
      return {
        ...base,
        type: 'json',
        value: (typeof value === 'object' ? value : {}) as Record<string, unknown>,
      }
    case 'option':
      return { ...base, type: 'option', optionId: String(value) }
    case 'relationship':
      return resolveRelationshipValue(base, field, value)
    case 'actor':
      return resolveActorValue(base, field, value)
    default:
      return null
  }
}

/**
 * Build a relationship TypedFieldValue from a FK column value.
 * Derives the target entity type from the field's inverseResourceFieldId.
 */
function resolveRelationshipValue(
  base: Record<string, unknown>,
  field: SystemFieldDescriptor,
  value: unknown
): TypedFieldValue | null {
  if (!field.relationship?.inverseResourceFieldId) return null

  const targetEntityDefId = parseResourceFieldId(
    field.relationship.inverseResourceFieldId as ResourceFieldId
  ).entityDefinitionId

  return {
    ...base,
    type: 'relationship',
    recordId: toRecordId(targetEntityDefId, String(value)),
  } as TypedFieldValue
}

/**
 * Build an actor TypedFieldValue from an actor ID column value.
 * Uses field options to determine actor type (user vs group).
 */
function resolveActorValue(
  base: Record<string, unknown>,
  field: SystemFieldDescriptor,
  value: unknown
): TypedFieldValue | null {
  const actorTarget = ((field.fieldOptions as any)?.actor?.target ?? 'user') as 'user' | 'group'
  const id = String(value)

  return {
    ...base,
    type: 'actor',
    actorType: actorTarget,
    id,
    actorId: toActorId(actorTarget, id),
  } as TypedFieldValue
}
