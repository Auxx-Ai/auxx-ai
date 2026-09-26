// packages/lib/src/resources/grouping/client.ts

import type { ColumnAggregateOp, GroupDateGranularity } from '../../conditions/view-config'
import type { ResourceField } from '../registry/field-types'

export { formatBucketLabel as formatGroupDateLabel } from '../../dashboards/date-bucket-labels'

/** Stands in for the null group key wherever a string key is required. */
export const EMPTY_GROUP_KEY = '__empty__'

/** Field types a table can group by (see plans/table/group-by-plan.md §1). */
export const GROUPABLE_FIELD_TYPES = new Set<string>([
  'SINGLE_SELECT',
  'RELATIONSHIP',
  'ACTOR',
  'CHECKBOX',
  'DATE',
  'DATETIME',
])

/** Field types whose group key is a date bucket rather than a raw value. */
export const GROUP_DATE_FIELD_TYPES = new Set<string>(['DATE', 'DATETIME'])

/** Column field types that can carry a per-column aggregate in the group header row. */
export const AGGREGATE_FIELD_TYPES = new Set<string>(['NUMBER', 'CURRENCY'])

export const GROUP_DATE_GRANULARITIES: ReadonlyArray<{
  value: GroupDateGranularity
  label: string
}> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
]

export const COLUMN_AGGREGATE_OPS: ReadonlyArray<{
  value: ColumnAggregateOp
  label: string
  /** Short prefix shown before the value in the group header cell. */
  short: string
}> = [
  { value: 'sum', label: 'Sum', short: 'Σ' },
  { value: 'avg', label: 'Average', short: 'avg' },
  { value: 'min', label: 'Min', short: 'min' },
  { value: 'max', label: 'Max', short: 'max' },
]

/** Effective storage type — CALC fields group/aggregate as their result type. */
function effectiveFieldType(field: ResourceField): string | undefined {
  const type = field.fieldType as string | undefined
  if (type === 'CALC') {
    return (field.options as { calc?: { resultFieldType?: string } } | undefined)?.calc
      ?.resultFieldType
  }
  return type
}

/** True when the field stores at most one value per record. */
export function isSingleValuedField(field: ResourceField): boolean {
  const options = field.options as { multi?: boolean; actor?: { multiple?: boolean } } | undefined
  if (options?.multi) return false
  const type = effectiveFieldType(field)
  if (type === 'ACTOR' && options?.actor?.multiple) return false
  if (type === 'RELATIONSHIP') {
    const relationshipType = field.relationship?.relationshipType
    return relationshipType === 'belongs_to' || relationshipType === 'has_one'
  }
  return true
}

/**
 * Whether a field may be a table's group-by field. Server and toolbar share this
 * so an option offered here is always one the server will honour.
 */
export function isGroupableField(field: ResourceField): boolean {
  const type = effectiveFieldType(field)
  if (!type || !GROUPABLE_FIELD_TYPES.has(type)) return false
  if (field.active === false) return false
  if (field.capabilities?.hidden) return false
  if (field.capabilities?.sortable === false) return false
  return isSingleValuedField(field)
}

/** Whether a column may carry a group header aggregate. */
export function isAggregatableField(field: ResourceField): boolean {
  const type = effectiveFieldType(field)
  if (!type || !AGGREGATE_FIELD_TYPES.has(type)) return false
  if (field.active === false || field.capabilities?.hidden) return false
  return isSingleValuedField(field)
}

/** Whether a groupable field's key is a date bucket (needs a granularity + timezone). */
export function isDateGroupField(field: ResourceField): boolean {
  const type = effectiveFieldType(field)
  return !!type && GROUP_DATE_FIELD_TYPES.has(type)
}
