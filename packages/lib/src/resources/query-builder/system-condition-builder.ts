// packages/lib/src/resources/query-builder/system-condition-builder.ts

import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import { getInstanceId, isRecordId, type RecordId } from '@auxx/types/resource'
import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  not,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { Operator } from '../../conditions/operator-definitions'
import { RESOURCE_FIELD_REGISTRY, RESOURCE_TABLE_MAP } from '../registry'
import type { TableId } from '../registry/field-registry'
import type { ResourceField } from '../registry/field-types'
import { type FieldOptionItem, getFieldOptions } from '../registry/option-helpers'
import { BaseType } from '../types'
import { BaseConditionBuilder, type GenericCondition } from './base-condition-builder'
import { resolveOlderThanCutoff, resolveRelativeDateRange } from './relative-date-range'

const logger = createScopedLogger('system-condition-builder')

/**
 * Does this registry field store its values in `FieldValue` rather than in a
 * column on the resource's own table?
 *
 * The test is what the field *declares*, not how its key is spelled. A
 * relationship that owns its side of the link (`isInverse !== true`) and has no
 * `dbColumn` has nowhere else to put its value: the rows are written by
 * `FieldValueService` against the org's materialized `CustomField` row and
 * found again by `systemAttribute` (`ArticleTagMutationService`,
 * `field-values/relationship-queries.ts`). `article:tags` is the case that made
 * this visible — it is not `custom_`-prefixed, so the prefix escape hatch never
 * saw it and every Tag filter fell through to "unresolved field" and widened
 * the result set to the full baseline.
 *
 * This is deliberately narrower than the entity builder's "any column-less
 * field is FieldValue-backed" rule (`entity-condition-builder.ts`). System
 * tables also carry column-less fields that are *not* in `FieldValue`:
 *
 * - virtual/computed fields resolved by another builder entirely — thread
 *   `from` / `to` / `body` / `free_text` are mail-query predicates, and the
 *   seeder refuses to materialize them at all (`shouldCreateField`);
 * - the inverse side of an FK column — `article:children`, `thread:messages`.
 *   The value lives in the *other* row's column, so no FieldValue row exists.
 *
 * Routing those into a FieldValue subquery would swap today's fail-open drop
 * for a silent fail-closed wrong answer, which is strictly worse.
 *
 * Not covered yet: column-less *scalar* system fields that the seeder does
 * materialize (thread `visit_ip` / `visit_url` — no `dbColumn` key at all, so
 * `shouldCreateField` keeps them). Those need typed-column (`valueText`, …)
 * comparisons rather than `relatedEntityId`; they still drop, which is the
 * safe direction.
 */
function isFieldValueBackedRelation(field: ResourceField): boolean {
  return (
    !field.dbColumn &&
    Boolean(field.systemAttribute) &&
    field.capabilities.filterable &&
    !field.capabilities.hidden &&
    field.type === BaseType.RELATION &&
    Boolean(field.relationship) &&
    field.relationship?.isInverse !== true
  )
}

/**
 * Normalize a relationship condition value to bare related-entity ids.
 *
 * Accepts every shape the filter surfaces produce: a `RecordId`
 * (`"<entityDefId>:<instanceId>"`), a bare id, `{ recordId }` (what
 * `FieldValueService` writes), `{ referenceId }` (the RELATION picker), or an
 * array of any of those. `FieldValue.relatedEntityId` stores the bare instance
 * id, so the definition prefix has to come off.
 */
function normalizeRelatedIds(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value]
  const ids: string[] = []

  for (const item of items) {
    const raw =
      item && typeof item === 'object'
        ? ((item as Record<string, unknown>).recordId ??
          (item as Record<string, unknown>).referenceId ??
          (item as Record<string, unknown>).id)
        : item
    if (typeof raw !== 'string' || raw.length === 0) continue
    const id = isRecordId(raw) ? getInstanceId(raw as RecordId) : raw
    if (id) ids.push(id)
  }

  return ids
}

/**
 * Condition builder for system resources (Contact, Ticket, etc.)
 * Uses Drizzle ORM column references for query building
 */
export class SystemConditionBuilder extends BaseConditionBuilder<TableId> {
  /**
   * Strip resource prefix from fieldId if present (e.g., "message:from" → "from").
   * UI stores ResourceFieldId format but registry keys are plain field names.
   */
  private stripFieldPrefix(fieldId: string): string {
    return fieldId.includes(':')
      ? parseResourceFieldId(fieldId as ResourceFieldId).fieldId
      : fieldId
  }

  // ─────────────────────────────────────────────────────────────────
  // ABSTRACT IMPLEMENTATIONS
  // ─────────────────────────────────────────────────────────────────

  protected conditionToSql(
    condition: GenericCondition,
    resourceType: TableId
  ): SQL<unknown> | undefined {
    // Handle custom fields (custom_xxx) with subquery
    const rawFieldId = Array.isArray(condition.fieldId) ? condition.fieldId[0] : condition.fieldId
    if (!rawFieldId) {
      logger.warn(`Condition ${condition.id} has an empty field reference`)
      return undefined
    }
    if (rawFieldId.startsWith('custom_')) {
      return this.buildCustomFieldSubquery(resourceType, rawFieldId, condition)
    }

    // Strip resource prefix for registry lookups (e.g., "message:from" → "from")
    const fieldId = this.stripFieldPrefix(rawFieldId)

    // FieldValue-backed relationships (article:tags) have no column to compare
    // against — route them to the FieldValue subquery before the column lookup
    // drops them and widens the query. See isFieldValueBackedRelation.
    const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[fieldId]
    if (field && isFieldValueBackedRelation(field)) {
      return this.buildRelationFieldValueSubquery(resourceType, field, condition)
    }

    const fieldMeta = this.resolveFieldMetadata(resourceType, fieldId)
    if (!fieldMeta) {
      logger.warn(`Unable to resolve metadata for field '${fieldId}' on ${resourceType}`)
      return undefined
    }

    // Extract ID from object format and transform option labels
    let rawValue = this.extractReferenceId(condition.value)
    if (fieldMeta.type === 'enum') {
      const fieldOpts = this.getFieldOptions(fieldId, resourceType)
      if (fieldOpts && fieldOpts.length > 0) {
        rawValue = this.labelToStoredValue(fieldOpts, rawValue)
      }
    }

    const normalizedType = fieldMeta.type === 'enum' ? 'string' : fieldMeta.type

    return this.buildOperatorSql(
      condition.operator,
      rawValue,
      fieldMeta.columns,
      normalizedType,
      resourceType,
      fieldId
    )
  }

  buildOrderBySql(
    field: string,
    direction: 'asc' | 'desc',
    resourceType: TableId
  ): SQL<unknown>[] | undefined {
    const fieldDef = RESOURCE_FIELD_REGISTRY[resourceType]?.[this.stripFieldPrefix(field)]
    if (!fieldDef?.capabilities.sortable || fieldDef.capabilities.hidden || !fieldDef.dbColumn) {
      return undefined
    }

    const tableName = RESOURCE_TABLE_MAP[resourceType].dbName
    const columns = this.resolveColumns([`${tableName}.${fieldDef.dbColumn}`])

    if (!columns.length) {
      return undefined
    }

    return columns.map((column) => (direction === 'desc' ? desc(column) : asc(column)))
  }

  protected getFieldType(fieldId: string, resourceType: TableId): string | undefined {
    // Custom fields are always valid (validated separately)
    if (fieldId.startsWith('custom_')) {
      return 'string'
    }

    const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[this.stripFieldPrefix(fieldId)]
    if (!field) return undefined

    return this.baseTypeToQueryType(field.type)
  }

  protected getFieldOptions(fieldId: string, resourceType: TableId): FieldOptionItem[] | undefined {
    const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[this.stripFieldPrefix(fieldId)]
    return getFieldOptions(field)
  }

  // ─────────────────────────────────────────────────────────────────
  // SYSTEM-SPECIFIC HELPERS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Build SQL for a specific operator using Drizzle column references
   */
  private buildOperatorSql(
    operator: Operator,
    rawValue: any,
    columns: AnyColumn[],
    normalizedType: string,
    resourceType: TableId,
    fieldId: string
  ): SQL<unknown> | undefined {
    switch (operator) {
      // ===== EQUALITY =====
      case 'is': {
        if (rawValue === null || rawValue === undefined) {
          return this.combineColumnPredicates(columns, (col) => isNull(col), 'and')
        }
        const value = this.convertValue(rawValue, normalizedType)
        return this.combineColumnPredicates(columns, (col) => eq(col, value))
      }

      case 'is not': {
        if (rawValue === null || rawValue === undefined) {
          return this.combineColumnPredicates(columns, (col) => not(isNull(col)), 'and')
        }
        const value = this.convertValue(rawValue, normalizedType)
        return this.combineColumnPredicates(columns, (col) => ne(col, value), 'and')
      }

      // ===== STRING =====
      case 'contains': {
        const value = `%${String(rawValue ?? '')}%`
        return this.combineColumnPredicates(columns, (col) => ilike(col, value))
      }

      case 'not contains': {
        const value = `%${String(rawValue ?? '')}%`
        return this.combineColumnPredicates(columns, (col) => not(ilike(col, value)), 'and')
      }

      case 'starts with': {
        const value = `${String(rawValue ?? '')}%`
        return this.combineColumnPredicates(columns, (col) => ilike(col, value))
      }

      case 'ends with': {
        const value = `%${String(rawValue ?? '')}`
        return this.combineColumnPredicates(columns, (col) => ilike(col, value))
      }

      // ===== COMPARISON =====
      case '>': {
        const value = this.convertValue(rawValue, normalizedType ?? 'number')
        return this.combineColumnPredicates(columns, (col) => gt(col, value))
      }

      case '<': {
        const value = this.convertValue(rawValue, normalizedType ?? 'number')
        return this.combineColumnPredicates(columns, (col) => lt(col, value))
      }

      case '>=': {
        const value = this.convertValue(rawValue, normalizedType ?? 'number')
        return this.combineColumnPredicates(columns, (col) => gte(col, value))
      }

      case '<=': {
        const value = this.convertValue(rawValue, normalizedType ?? 'number')
        return this.combineColumnPredicates(columns, (col) => lte(col, value))
      }

      // ===== SET =====
      case 'in': {
        const values = this.normalizeArrayWithOptions(
          rawValue,
          normalizedType,
          resourceType,
          fieldId
        )
        if (!values.length) return undefined
        return this.combineColumnPredicates(columns, (col) => inArray(col, values))
      }

      case 'not in': {
        const values = this.normalizeArrayWithOptions(
          rawValue,
          normalizedType,
          resourceType,
          fieldId
        )
        if (!values.length) return undefined
        return this.combineColumnPredicates(columns, (col) => notInArray(col, values), 'and')
      }

      // ===== DATE (same-day) =====
      case 'on_date': {
        if (rawValue === null || rawValue === undefined) return undefined
        const date = new Date(rawValue)
        const startOfDay = new Date(date)
        startOfDay.setHours(0, 0, 0, 0)
        const endOfDay = new Date(date)
        endOfDay.setHours(23, 59, 59, 999)
        return this.combineColumnPredicates(columns, (col) =>
          and(gte(col, startOfDay), lte(col, endOfDay))
        )
      }

      case 'not_on_date': {
        if (rawValue === null || rawValue === undefined) return undefined
        const date = new Date(rawValue)
        const startOfDay = new Date(date)
        startOfDay.setHours(0, 0, 0, 0)
        const endOfDay = new Date(date)
        endOfDay.setHours(23, 59, 59, 999)
        return this.combineColumnPredicates(
          columns,
          (col) => or(lt(col, startOfDay), gt(col, endOfDay)),
          'and'
        )
      }

      // ===== EXISTENCE =====
      // Only string-like columns can hold ''. Comparing date/number/boolean
      // columns to '' makes Drizzle call .toISOString()/Number()/etc. on the
      // empty string and blow up — so for those types check NULL only.
      case 'empty': {
        const isStringLike = normalizedType === 'string' || normalizedType === 'enum'
        return this.combineColumnPredicates(
          columns,
          (col) => (isStringLike ? or(isNull(col), eq(col, '')) : isNull(col)),
          'and'
        )
      }

      case 'not empty': {
        const isStringLike = normalizedType === 'string' || normalizedType === 'enum'
        return this.combineColumnPredicates(
          columns,
          (col) => (isStringLike ? and(isNotNull(col), not(eq(col, ''))) : isNotNull(col)),
          'and'
        )
      }

      // ===== RELATIVE DATE =====
      case 'today':
      case 'yesterday':
      case 'this_week':
      case 'this_month':
      case 'within_days': {
        const range = resolveRelativeDateRange(operator, rawValue)
        if (!range) return undefined
        return this.combineColumnPredicates(columns, (col) =>
          and(gte(col, range.start), lt(col, range.end))
        )
      }

      case 'older_than_days': {
        const cutoff = resolveOlderThanCutoff(rawValue)
        if (!cutoff) return undefined
        return this.combineColumnPredicates(columns, (col) => lt(col, cutoff), 'and')
      }

      // ===== DATE (open-ended) =====
      // The generic condition UI offers these for every DATE/DATETIME/TIME
      // field (`operator-definitions.ts`), and `EntityConditionBuilder` has
      // always compiled them. Without these cases "Published At after X"
      // reached the default arm and compiled to `publishedAt = X`.
      case 'before':
      case 'after': {
        const value = this.toDateValue(rawValue, normalizedType)
        if (!value) return undefined
        return this.combineColumnPredicates(columns, (col) =>
          operator === 'before' ? lt(col, value) : gt(col, value)
        )
      }

      default: {
        // Return NO SQL, never a guess. An `eq(col, value)` fallback here is
        // invisible to every diagnostic: it produces a clause, so the condition
        // is not recorded as a `DroppedCondition`, `allConditionsDropped` stays
        // false, and the AI tool boundary passes the wrong answer through. A
        // recorded drop widens the result set — wrong SQL answers a different
        // question and says nothing. Operators with no case here (`length =`,
        // `has key`, `key equals`, the file-inspection set) have no column
        // semantics on a system table.
        logger.warn(`Unknown operator '${operator}' for field '${fieldId}' on ${resourceType}`)
        return undefined
      }
    }
  }

  /**
   * Coerce a condition value to a `Date` for date-column comparison.
   *
   * Returns undefined for a non-date column or an unparseable value: Drizzle
   * calls `.toISOString()` on whatever it is handed for a timestamp column, so
   * passing a raw string through throws at query build time instead of
   * producing a drop.
   */
  private toDateValue(rawValue: any, normalizedType: string): Date | undefined {
    if (normalizedType !== 'date' || rawValue === null || rawValue === undefined) return undefined
    const value = this.convertValue(rawValue, 'date')
    return value instanceof Date && !Number.isNaN(value.getTime()) ? value : undefined
  }

  /**
   * Combine predicates across columns with AND/OR
   */
  private combineColumnPredicates(
    columns: AnyColumn[],
    builder: (column: AnyColumn) => SQL<unknown> | undefined,
    logicalMode: 'and' | 'or' = 'or'
  ): SQL<unknown> | undefined {
    const clauses = columns
      .map((col) => builder(col))
      .filter((clause): clause is SQL<unknown> => Boolean(clause))
    if (clauses.length === 0) return undefined
    if (clauses.length === 1) return clauses[0]
    return logicalMode === 'and' ? and(...clauses) : or(...clauses)
  }

  /**
   * Resolve field metadata from registry
   */
  private resolveFieldMetadata(
    resourceType: TableId,
    fieldId: string
  ): { columns: AnyColumn[]; type: string } | undefined {
    const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[this.stripFieldPrefix(fieldId)]
    if (!field || !field.capabilities.filterable || field.capabilities.hidden || !field.dbColumn) {
      return undefined
    }

    const tableName = RESOURCE_TABLE_MAP[resourceType].dbName
    const columns = this.resolveColumns([`${tableName}.${field.dbColumn}`])
    if (!columns.length) return undefined

    return {
      columns,
      type: this.baseTypeToQueryType(field.type),
    }
  }

  /**
   * Resolve column paths to Drizzle column references
   */
  private resolveColumns(columnPaths: string[]): AnyColumn[] {
    const resolved: AnyColumn[] = []

    for (const path of columnPaths) {
      const [tableKey, columnKey] = path.split('.')
      if (!tableKey || !columnKey) continue

      const table = (schema as Record<string, any>)[tableKey]
      if (!table) continue

      const column = table[columnKey]
      if (!column) continue

      resolved.push(column as AnyColumn)
    }

    return resolved
  }

  /**
   * Normalize array with option label transformation
   */
  private normalizeArrayWithOptions(
    value: any,
    expectedType: string,
    resourceType: TableId,
    fieldId: string
  ): (string | number | boolean | Date)[] {
    const fieldOpts =
      expectedType === 'enum' ? this.getFieldOptions(fieldId, resourceType) : undefined

    const values = Array.isArray(value) ? value : [value]
    return values
      .map((item) => {
        item = this.extractReferenceId(item)
        if (expectedType === 'enum' && fieldOpts && fieldOpts.length > 0) {
          item = this.labelToStoredValue(fieldOpts, item)
        }
        return this.convertValue(item, expectedType === 'enum' ? 'string' : expectedType)
      })
      .filter((item): item is string | number | boolean | Date => item !== undefined)
  }

  /**
   * Build the EXISTS subquery for a FieldValue-backed system *relationship*
   * (`article:tags`, `thread:tags`).
   *
   * Keyed on `CustomField.systemAttribute` rather than a field id, because the
   * id is the org's materialized `CustomField` row and the registry only knows
   * the attribute. Same shape as `threadHasTags` in
   * `field-values/relationship-queries.ts`. Org scoping comes from the outer
   * query: `fv."entityId"` is correlated to the already org-scoped row, and a
   * FieldValue row can only point at a CustomField in its own org.
   *
   * Multi-value semantics, which is where this differs from the entity
   * builder's scalar `is not`: a record can hold many tags, so "Tag is not X"
   * means "does not carry X" (`NOT EXISTS`), not "carries something ≠ X".
   */
  private buildRelationFieldValueSubquery(
    resourceType: TableId,
    field: ResourceField,
    condition: GenericCondition
  ): SQL<unknown> | undefined {
    const systemAttribute = field.systemAttribute
    const tableInfo = RESOURCE_TABLE_MAP[resourceType]
    const resourceTable = tableInfo ? (schema as Record<string, any>)[tableInfo.dbName] : undefined
    const outerId = resourceTable?.id
    if (!systemAttribute || !outerId) return undefined

    const hasAnyRelated = sql`EXISTS (
      SELECT 1 FROM ${schema.FieldValue} fv
      INNER JOIN ${schema.CustomField} cf ON fv."fieldId" = cf."id"
      WHERE cf."systemAttribute" = ${systemAttribute}
        AND fv."entityId" = ${outerId}
        AND fv."relatedEntityId" IS NOT NULL
    )`

    const hasOneOf = (ids: string[]): SQL<unknown> => sql`EXISTS (
      SELECT 1 FROM ${schema.FieldValue} fv
      INNER JOIN ${schema.CustomField} cf ON fv."fieldId" = cf."id"
      WHERE cf."systemAttribute" = ${systemAttribute}
        AND fv."entityId" = ${outerId}
        AND fv."relatedEntityId" IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `
        )})
    )`

    switch (condition.operator) {
      case 'empty':
        return sql`NOT ${hasAnyRelated}`

      case 'not empty':
        return hasAnyRelated

      // `contains` is what the UI offers for a multi-value relationship, and it
      // means the same thing as `is` here: the record carries this related row.
      case 'is':
      case 'in':
      case 'contains': {
        const ids = normalizeRelatedIds(condition.value)
        return ids.length ? hasOneOf(ids) : undefined
      }

      case 'is not':
      case 'not in':
      case 'not contains': {
        const ids = normalizeRelatedIds(condition.value)
        return ids.length ? sql`NOT ${hasOneOf(ids)}` : undefined
      }

      default:
        logger.warn(
          `Operator '${condition.operator}' not supported for FieldValue-backed relationship '${field.key}' on ${resourceType}`
        )
        return undefined
    }
  }

  /**
   * Build EXISTS subquery for FieldValue table
   * This is specific to system resources that support custom fields
   */
  private buildCustomFieldSubquery(
    resourceType: TableId,
    fieldRef: string,
    condition: GenericCondition
  ): SQL<unknown> | undefined {
    const customFieldId = fieldRef.replace(/^custom_/, '')
    const tableInfo = RESOURCE_TABLE_MAP[resourceType]
    if (!tableInfo) return undefined

    const resourceTable = (schema as Record<string, any>)[tableInfo.dbName]
    if (!resourceTable) return undefined

    // 'empty' means NO FieldValue row exists for this field — the write path
    // deletes the row when a value is cleared, so an EXISTS(... value IS NULL)
    // subquery can never match. Answer it with NOT EXISTS instead.
    if (condition.operator === 'empty') {
      return sql`NOT EXISTS (
        SELECT 1 FROM ${schema.FieldValue}
        WHERE ${schema.FieldValue.entityId} = ${resourceTable.id}
          AND ${schema.FieldValue.fieldId} = ${customFieldId}
      )`
    }

    const valueCondition = this.buildCustomFieldValueCondition(condition.operator, condition.value)
    if (!valueCondition) return undefined

    return sql`EXISTS (
      SELECT 1 FROM ${schema.FieldValue}
      WHERE ${schema.FieldValue.entityId} = ${resourceTable.id}
        AND ${schema.FieldValue.fieldId} = ${customFieldId}
        AND ${valueCondition}
    )`
  }

  /**
   * Build value condition for FieldValue typed columns.
   * Uses COALESCE across typed columns to produce a comparable text value,
   * matching the old CustomFieldValue JSONB behavior.
   */
  private buildCustomFieldValueCondition(operator: Operator, value: any): SQL<unknown> | undefined {
    // COALESCE across typed columns to get a text representation
    const textValue = sql`COALESCE(${schema.FieldValue.valueText}, ${schema.FieldValue.optionId}, CAST(${schema.FieldValue.valueNumber} AS text), CAST(${schema.FieldValue.valueBoolean} AS text), CAST(${schema.FieldValue.valueDate} AS text))`

    switch (operator) {
      case 'is':
        if (value === null || value === undefined) {
          return sql`${textValue} IS NULL`
        }
        return sql`${textValue} = ${String(value)}`

      case 'is not':
        if (value === null || value === undefined) {
          return sql`${textValue} IS NOT NULL`
        }
        return sql`${textValue} != ${String(value)}`

      case 'contains':
        return sql`${textValue} ILIKE ${'%' + String(value ?? '') + '%'}`

      case 'not contains':
        return sql`${textValue} NOT ILIKE ${'%' + String(value ?? '') + '%'}`

      case 'starts with':
        return sql`${textValue} ILIKE ${String(value ?? '') + '%'}`

      case 'ends with':
        return sql`${textValue} ILIKE ${'%' + String(value ?? '')}`

      case '>':
        return sql`${schema.FieldValue.valueNumber} > ${Number(value)}`

      case '<':
        return sql`${schema.FieldValue.valueNumber} < ${Number(value)}`

      case '>=':
        return sql`${schema.FieldValue.valueNumber} >= ${Number(value)}`

      case '<=':
        return sql`${schema.FieldValue.valueNumber} <= ${Number(value)}`

      case 'in': {
        const values = Array.isArray(value) ? value : [value]
        if (!values.length) return undefined
        const conditions = values.map((v) => sql`${textValue} = ${String(v)}`)
        return conditions.length === 1 ? conditions[0] : sql`(${sql.join(conditions, sql` OR `)})`
      }

      case 'not in': {
        const values = Array.isArray(value) ? value : [value]
        if (!values.length) return undefined
        const conditions = values.map((v) => sql`${textValue} != ${String(v)}`)
        return conditions.length === 1 ? conditions[0] : sql`(${sql.join(conditions, sql` AND `)})`
      }

      case 'empty':
        // Unreachable — buildCustomFieldSubquery short-circuits 'empty' to a
        // bare NOT EXISTS (row) under the FieldValue write-path invariant.
        return sql`(${textValue} IS NULL OR ${textValue} = '')`

      case 'not empty':
        return sql`(${textValue} IS NOT NULL AND ${textValue} != '')`

      default:
        return undefined
    }
  }
}

// Export singleton instance for convenience
export const systemConditionBuilder = new SystemConditionBuilder()
