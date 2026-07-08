// apps/web/src/components/dashboard/hooks/use-metric-field.ts
'use client'

// Resolves a widget metric's underlying field into the `FieldType` + `FieldOptions`
// that `formatMetricValue` needs to render the aggregate the same way the records
// table / field displays would. Count-family metrics carry no `fieldRef` (→ empty
// meta), and one-hop `FieldPath` metrics can't be resolved by `useField` (→ empty
// meta, plain-number fallback) — both are fine, they format dimensionlessly.
//
// The optional `valueFormat` override (plan 10) is merged OVER the field's native
// options, so a widget can diverge from the field's default display (fewer
// decimals, compact notation…) while still inheriting everything it doesn't set.

import type { Metric } from '@auxx/lib/dashboards/client'
import type { FieldOptions } from '@auxx/lib/field-values/client'
import { isFieldPath } from '@auxx/types/field'
import { useMemo } from 'react'
import { useField } from '~/components/resources/hooks/use-field'
import type { MetricFieldMeta } from '../lib/format-value'

/**
 * Resolve the metric field's display metadata (empty for count/FieldPath
 * metrics), with an optional per-widget `valueFormat` override layered on top.
 */
export function useMetricFieldMeta(metric: Metric, valueFormat?: FieldOptions): MetricFieldMeta {
  const ref = metric.fieldRef
  const field = useField(ref && !isFieldPath(ref) ? ref : null)

  return useMemo(
    () => ({
      // `effectiveFieldType` unwraps CALC → its result type.
      fieldType: field?.effectiveFieldType,
      options:
        field?.options || valueFormat
          ? { ...(field?.options as FieldOptions | undefined), ...valueFormat }
          : undefined,
    }),
    [field, valueFormat]
  )
}
