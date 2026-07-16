// apps/web/src/components/dashboard/lib/format-value.ts
//
// Formats an aggregate metric value for KPI / gauge / chart display, driven by
// the metric field's `FieldType` + `FieldOptions` so a dashboard renders numbers
// exactly like the records table and field displays do — no bespoke formatter.
//
// The one wrinkle: CURRENCY is stored as CENTS across the app (see
// `fields/displays/display-currency.tsx` + the table's `renderCurrencyValue`),
// and `@auxx/utils`' `formatCurrency` expects cents — so currency routes through
// `formatCurrency`, NOT `formatToDisplayValue` (whose currency converter assumes
// dollars and would render 100× high). NUMBER/DATE reuse their converters.
//
// Field-less ops (count family) and dimensionless percent ops have no field to
// inherit from, so they fall back to plain `Intl` number / `%`.

import type { FieldType } from '@auxx/database/types'
import type { MetricOp } from '@auxx/lib/dashboards/client'
import {
  converters,
  type FieldOptions,
  type NumberFieldOptions,
} from '@auxx/lib/field-values/client'
import {
  type CurrencyDisplayOptions,
  formatCurrency,
  formatCurrencyCompact,
  formatNumberCompact,
} from '@auxx/utils'

/** The metric field's display metadata, resolved via `useMetricFieldMeta`. */
export type MetricFieldMeta = { fieldType?: FieldType; options?: FieldOptions }

/** Ops that count rows — dimensionless integers, no underlying field. */
const COUNT_OPS: ReadonlySet<MetricOp> = new Set<MetricOp>([
  'count',
  'countUnique',
  'countEmpty',
  'countNotEmpty',
  'countTrue',
  'countFalse',
])

/** Ops whose result is already a 0–100 percentage. */
const PERCENT_OPS: ReadonlySet<MetricOp> = new Set<MetricOp>(['percentEmpty', 'percentNotEmpty'])

/**
 * Format an aggregate value for display.
 *
 * - `percent*` ops → `NN.N%` (value is already 0–100, not multiplied).
 * - `count*` ops → grouped integer.
 * - `sum`/`avg`/`min`/`max` → inherit the metric field's display:
 *   CURRENCY via `formatCurrency` (cents), NUMBER/DATE via their converters,
 *   all honoring the field's `FieldOptions`.
 * - No field metadata (e.g. a one-hop `FieldPath` metric, or before the field
 *   resolves) → plain grouped number.
 */
export function formatMetricValue(value: number, op: MetricOp, meta?: MetricFieldMeta): string {
  if (!Number.isFinite(value)) return '—'

  if (PERCENT_OPS.has(op)) {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`
  }
  if (COUNT_OPS.has(op)) {
    // Counts have no underlying field, so they default to a grouped integer —
    // but honor a per-widget `valueFormat` override (e.g. compact `1.2K`) when set.
    return meta?.options
      ? converters.NUMBER.toDisplayValue({ type: 'number', value }, meta.options)
      : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
  }

  const { fieldType, options } = meta ?? {}

  if (fieldType === 'CURRENCY') {
    // Stored as cents — formatCurrency expects cents.
    return formatCurrency(value, options as CurrencyDisplayOptions | undefined)
  }
  if (fieldType === 'NUMBER') {
    return converters.NUMBER.toDisplayValue({ type: 'number', value }, options)
  }
  if (fieldType === 'DATE' || fieldType === 'DATETIME') {
    // min/max on a date field come back as epoch millis.
    const iso = new Date(value).toISOString()
    return String(converters[fieldType].toDisplayValue({ type: 'date', value: iso }, options) ?? '')
  }

  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
}

/**
 * Compact variant of `formatMetricValue` for AXIS TICKS and data labels —
 * approximate but short: `$12K` / `$2.3M` / `1.2K`. Tooltips, KPIs and the
 * pie center total keep the full `formatMetricValue` precision; axes trade
 * precision for room (a fixed-width axis clips `$12,000.00`-style ticks).
 * Percent/date values and NUMBER fields with a special `displayAs`
 * (percentage/bytes) are already short, so they delegate to the full formatter.
 */
export function formatMetricValueCompact(
  value: number,
  op: MetricOp,
  meta?: MetricFieldMeta
): string {
  if (!Number.isFinite(value)) return '—'
  if (PERCENT_OPS.has(op)) return formatMetricValue(value, op, meta)
  if (COUNT_OPS.has(op)) return formatNumberCompact(value)

  const { fieldType, options } = meta ?? {}

  if (fieldType === 'CURRENCY') {
    // Stored as cents — formatCurrencyCompact expects cents.
    return formatCurrencyCompact(value, options as CurrencyDisplayOptions | undefined)
  }
  if (fieldType === 'DATE' || fieldType === 'DATETIME') {
    return formatMetricValue(value, op, meta)
  }
  if (fieldType === 'NUMBER') {
    const o = (options ?? {}) as NumberFieldOptions
    if (o.displayAs === 'percentage' || o.displayAs === 'bytes') {
      return formatMetricValue(value, op, meta)
    }
    return `${o.prefix ?? ''}${formatNumberCompact(value)}${o.suffix ?? ''}`
  }

  return formatNumberCompact(value)
}

export type TrendDelta = {
  /** Signed absolute change (`current - previous`). */
  change: number
  /** Signed percentage change; `null` when the previous value is 0 (undefined ratio). */
  percent: number | null
  direction: 'up' | 'down' | 'flat'
}

/**
 * Compute the KPI trend delta between the current and previous window values.
 * Pure — the only branch worth testing (zero-previous → undefined ratio, and the
 * flat/up/down direction). `previous` absent ⇒ no trend (`null`).
 */
export function computeTrendDelta(
  current: number,
  previous: number | undefined
): TrendDelta | null {
  if (previous === undefined || !Number.isFinite(previous)) return null
  const change = current - previous
  const percent = previous === 0 ? null : (change / Math.abs(previous)) * 100
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
  return { change, percent, direction }
}

/** Signed, rounded percent for display (`+12.3%` / `-4%`). `null` percent ⇒ `—`. */
export function formatTrendPercent(percent: number | null): string {
  if (percent === null) return '—'
  const rounded = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format(percent)
  return `${rounded}%`
}
