// apps/web/src/components/dashboard/ui/config/style-section.tsx
'use client'

// Shared style/appearance controls for the config panel (plan 07): the chart
// color select (over the `--chart-N` palette), a numeric range pair, and the
// dashboard date-range binding row. Per-kind toggles (legend/stacked/donut/…)
// live in the kind config bodies as ConfigFieldRow switches; these are the
// reused-across-kinds pieces.

import { FieldType } from '@auxx/database/enums'
import type {
  DateLabelFormat,
  GroupBy,
  WidgetFieldRef,
  WidgetSource,
} from '@auxx/lib/dashboards/client'
import type { SelectOption } from '@auxx/types/custom-field'
import { isFieldPath, type ResourceFieldId } from '@auxx/types/field'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import { FieldPicker } from '~/components/pickers/field-picker/field-picker'
import { useField } from '~/components/resources/hooks/use-field'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { effectiveFieldTypeOf, isRelationshipField } from '../../lib/field-meta'
import { sourceResourceId } from '../../lib/widget-source'
import { ConfigFieldRow } from './config-field-row'

// The chart color-SCHEME picker now lives in its own file (plan 12); re-exported
// here so the config bodies keep importing `ColorRow` from `style-section`.
export { ColorRow } from './color-scheme-row'

export function RangeRows({
  min,
  max,
  onChange,
  maxRequired,
}: {
  min: number | undefined
  max: number | undefined
  onChange: (patch: { rangeMin?: number; rangeMax?: number }) => void
  maxRequired?: boolean
}) {
  return (
    <>
      <ConfigFieldRow
        title='Min'
        description='The value at the empty end of the gauge — usually 0.'
        fieldType={FieldType.NUMBER}
        value={min}
        onChange={(v) => onChange({ rangeMin: v as number | undefined })}
        placeholder='0'
      />
      <ConfigFieldRow
        title='Max'
        description='The target the gauge fills toward (100%).'
        fieldType={FieldType.NUMBER}
        value={max}
        onChange={(v) => onChange({ rangeMax: v as number | undefined })}
        placeholder='Auto'
        isRequired={maxRequired}
        validationError={maxRequired && max == null ? 'A gauge needs a target max' : undefined}
      />
    </>
  )
}

const leaf = (ref: WidgetFieldRef): ResourceFieldId =>
  isFieldPath(ref) ? ref[ref.length - 1] : ref

const DATE_LABEL_FORMAT_OPTIONS: SelectOption[] = [
  { value: 'default', label: 'Default' },
  { value: 'short', label: 'Short' },
  { value: 'long', label: 'Long' },
  { value: 'iso', label: 'Numeric' },
]

/**
 * Category-axis date label style (plan 10). Shown ONLY when the primary group-by
 * is a DATE/DATETIME field — the raw bucket key is reformatted client-side, no
 * re-query. `'default'` ⇒ clears the override (server's default label style).
 */
export function DateAxisFormatRow({
  source,
  groupBy,
  value,
  onChange,
}: {
  source: WidgetSource
  groupBy: GroupBy | undefined
  value: DateLabelFormat | undefined
  onChange: (value: DateLabelFormat | undefined) => void
}) {
  const field = useField(groupBy?.fieldRef ? leaf(groupBy.fieldRef) : null)
  const ft = field ? effectiveFieldTypeOf(field) : undefined
  if (ft !== 'DATE' && ft !== 'DATETIME') return null

  return (
    <ConfigFieldRow
      title='Date label format'
      description='How date labels read on the axis — e.g. “Jan 2026” vs “2026-01”.'
      fieldType={FieldType.SINGLE_SELECT}
      fieldOptions={{ options: DATE_LABEL_FORMAT_OPTIONS }}
      value={value ?? 'default'}
      onChange={(v) => onChange(v === 'default' ? undefined : (v as DateLabelFormat))}
    />
  )
}

/**
 * The DATE/DATETIME field the dashboard-level range filters this widget on.
 * `null` = "Not affected" (opt out); `undefined` = inherit the default binding.
 */
export function GlobalDateBindingRow({
  source,
  value,
  onChange,
}: {
  source: WidgetSource
  value: WidgetFieldRef | null | undefined
  onChange: (ref: WidgetFieldRef | null) => void
}) {
  const field = useField(value ? leaf(value) : null)
  const label = value === null ? 'Not affected' : (field?.label ?? undefined)

  return (
    <FieldPanelRow
      title='Dashboard date range'
      description="Which date field this widget filters when the dashboard's date range changes — off to ignore it.">
      <FieldPicker
        entityDefinitionId={sourceResourceId(source)}
        width={280}
        filterField={(f) => {
          const ft = effectiveFieldTypeOf(f)
          return isRelationshipField(f) || ft === 'DATE' || ft === 'DATETIME'
        }}
        onSkip={() => onChange(null)}
        skipLabel='Not affected'
        onSelect={(ref) => onChange(ref as WidgetFieldRef)}
        trigger={
          <PickerTrigger
            hasValue={value !== undefined}
            placeholder='Default (created date)'
            className='w-full ps-0 pe-1'>
            <span className='truncate text-sm'>{label ?? 'Field'}</span>
          </PickerTrigger>
        }
      />
    </FieldPanelRow>
  )
}
