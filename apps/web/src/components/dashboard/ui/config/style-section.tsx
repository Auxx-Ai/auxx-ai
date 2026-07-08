// apps/web/src/components/dashboard/ui/config/style-section.tsx
'use client'

// Shared style/appearance controls for the config panel (plan 07): the chart
// color select (over the `--chart-N` palette), a numeric range pair, and the
// dashboard date-range binding row. Per-kind toggles (legend/stacked/donut/…)
// live in the kind config bodies as ConfigFieldRow switches; these are the
// reused-across-kinds pieces.

import { FieldType } from '@auxx/database/enums'
import type { WidgetFieldRef, WidgetSource } from '@auxx/lib/dashboards/client'
import type { SelectOption } from '@auxx/types/custom-field'
import { isFieldPath, type ResourceFieldId } from '@auxx/types/field'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import { FieldPicker } from '~/components/pickers/field-picker/field-picker'
import { useField } from '~/components/resources/hooks/use-field'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { effectiveFieldTypeOf, isRelationshipField } from '../../lib/field-meta'
import { sourceResourceId } from '../../lib/widget-source'
import { ConfigFieldRow } from './config-field-row'

const COLOR_OPTIONS: SelectOption[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'var(--chart-1)', label: 'Color 1' },
  { value: 'var(--chart-2)', label: 'Color 2' },
  { value: 'var(--chart-3)', label: 'Color 3' },
  { value: 'var(--chart-4)', label: 'Color 4' },
  { value: 'var(--chart-5)', label: 'Color 5' },
]

export function ColorRow({
  value,
  onChange,
}: {
  value: string | undefined
  onChange: (value: string) => void
}) {
  return (
    <ConfigFieldRow
      title='Color'
      fieldType={FieldType.SINGLE_SELECT}
      fieldOptions={{ options: COLOR_OPTIONS }}
      value={value ?? 'auto'}
      onChange={(v) => onChange(String(v ?? 'auto'))}
    />
  )
}

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
        fieldType={FieldType.NUMBER}
        value={min}
        onChange={(v) => onChange({ rangeMin: v as number | undefined })}
        placeholder='0'
      />
      <ConfigFieldRow
        title='Max'
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
      description='Which date field the dashboard-level range filters'>
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
