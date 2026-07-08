// apps/web/src/components/dashboard/lib/metric-ops.ts
//
// The metric-op vocabulary for the widget config panel (plan 07): which
// aggregation ops a field of a given FieldType can carry, their human labels,
// and the trigger summary ("Sum of Amount" / "Count of records"). Kept in exact
// lockstep with the server's `validateMetric` matrix in
// `packages/lib/src/resources/aggregate/run-aggregate.ts` — offering an op the
// aggregate engine rejects would 422 on the first chartData fetch. Pure + tested.

import type { FieldType } from '@auxx/database/enums'
import type { MetricOp } from '@auxx/lib/dashboards/client'

export type MetricOpOption = { op: MetricOp; label: string }

// ── Field-type buckets (mirror run-aggregate.ts) ─────────────────────────────

/** Never aggregatable, even as a picked field — only "Count records" applies. */
const INVALID_METRIC_FIELD_TYPES = new Set<FieldType>(['CALC', 'FILE', 'JSON', 'RICH_TEXT'])
/** Additionally hidden from the metric FIELD list (aggregatable in theory, meaningless in practice). */
const HIDDEN_METRIC_FIELD_TYPES = new Set<FieldType>(['NAME', 'ADDRESS', 'ADDRESS_STRUCT'])
/** Never groupable (mirror INVALID_GROUP_FIELD_TYPES). */
const INVALID_GROUP_FIELD_TYPES = new Set<FieldType>([
  'CALC',
  'FILE',
  'JSON',
  'RICH_TEXT',
  'NAME',
  'ADDRESS_STRUCT',
  'TIME',
])

const NUMERIC_FIELD_TYPES = new Set<FieldType>(['NUMBER', 'CURRENCY'])
const DATE_FAMILY_FIELD_TYPES = new Set<FieldType>(['DATE', 'DATETIME', 'TIME'])
/** Date fields that accept a granularity bucket (excludes TIME). */
const GRANULARITY_FIELD_TYPES = new Set<FieldType>(['DATE', 'DATETIME'])

// ── Predicates for the field pickers ─────────────────────────────────────────

/** Can this field type back a metric (be picked in the metric field list)? */
export function isAggregableFieldType(fieldType: FieldType | undefined): boolean {
  if (!fieldType) return false
  return !INVALID_METRIC_FIELD_TYPES.has(fieldType) && !HIDDEN_METRIC_FIELD_TYPES.has(fieldType)
}

/** Can this field type be a group-by dimension? */
export function isGroupableFieldType(fieldType: FieldType | undefined): boolean {
  if (!fieldType) return false
  return !INVALID_GROUP_FIELD_TYPES.has(fieldType)
}

/** Does grouping by this field type expose a date-granularity control? */
export function supportsDateGranularity(fieldType: FieldType | undefined): boolean {
  return !!fieldType && GRANULARITY_FIELD_TYPES.has(fieldType)
}

// ── Op labels ────────────────────────────────────────────────────────────────

const BASE_OP_LABELS: Record<MetricOp, string> = {
  count: 'Count',
  sum: 'Sum',
  avg: 'Average',
  min: 'Minimum',
  max: 'Maximum',
  countUnique: 'Unique values',
  countEmpty: 'Empty',
  countNotEmpty: 'Not empty',
  countTrue: 'Checked',
  countFalse: 'Unchecked',
  percentEmpty: 'Percent empty',
  percentNotEmpty: 'Percent not empty',
}

/** Op label, specialized for date fields where min/max read as earliest/latest. */
export function metricOpLabel(op: MetricOp, fieldType?: FieldType): string {
  if (fieldType && DATE_FAMILY_FIELD_TYPES.has(fieldType)) {
    if (op === 'min') return 'Earliest'
    if (op === 'max') return 'Latest'
  }
  return BASE_OP_LABELS[op]
}

// ── Op lists per field type ──────────────────────────────────────────────────

const CATEGORICAL_OPS: MetricOp[] = [
  'count',
  'countUnique',
  'countEmpty',
  'countNotEmpty',
  'percentEmpty',
  'percentNotEmpty',
]

/**
 * The aggregation ops offered for a field of `fieldType`, in menu order. Every
 * op here is accepted by the server's `validateMetric` for that field type.
 */
export function metricOpsForFieldType(fieldType: FieldType): MetricOpOption[] {
  const ops = ((): MetricOp[] => {
    if (NUMERIC_FIELD_TYPES.has(fieldType)) {
      return ['sum', 'avg', 'min', 'max', 'count', 'countUnique', 'countEmpty', 'countNotEmpty']
    }
    if (DATE_FAMILY_FIELD_TYPES.has(fieldType)) {
      return ['count', 'min', 'max', 'countEmpty', 'countNotEmpty']
    }
    if (fieldType === 'CHECKBOX') {
      return ['countTrue', 'countFalse', 'count']
    }
    if (fieldType === 'RELATIONSHIP' || fieldType === 'ACTOR') {
      return ['count', 'countUnique', 'countNotEmpty']
    }
    // SINGLE_SELECT / MULTI_SELECT / TAGS / TEXT / EMAIL / URL / PHONE_INTL → categorical
    return CATEGORICAL_OPS
  })()
  return ops.map((op) => ({ op, label: metricOpLabel(op, fieldType) }))
}

/** The trigger summary for a chosen metric: "Count of records", "Sum of Amount". */
export function metricTriggerLabel(
  op: MetricOp,
  fieldType: FieldType | undefined,
  fieldLabel: string | undefined
): string {
  if (op === 'count' && !fieldLabel) return 'Count of records'
  const opLabel = metricOpLabel(op, fieldType)
  return fieldLabel ? `${opLabel} of ${fieldLabel}` : opLabel
}
