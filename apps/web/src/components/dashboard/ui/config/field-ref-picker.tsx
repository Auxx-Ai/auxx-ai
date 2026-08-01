// apps/web/src/components/dashboard/ui/config/field-ref-picker.tsx
'use client'

// A FieldPanelRow-wrapped FieldPicker that stores a `WidgetFieldRef` verbatim
// (plan 07). The real FieldPicker already returns branded ResourceFieldId /
// FieldPath refs with relationship drill-down, which ARE WidgetFieldRefs — no
// conversion. Shared by the group-by field, record-list columns, and the date
// bindings. The trigger shows the picked field's leaf label (last hop).

import type { WidgetFieldRef, WidgetSource } from '@auxx/lib/dashboards/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { isFieldPath, type ResourceFieldId } from '@auxx/types/field'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import { FieldPicker } from '~/components/pickers/field-picker/field-picker'
import { useField } from '~/components/resources/hooks/use-field'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { sourceResourceId } from '../../lib/widget-source'

/** The leaf (last-hop) ResourceFieldId a WidgetFieldRef resolves to, for labels. */
function leafRef(ref: WidgetFieldRef): ResourceFieldId {
  return isFieldPath(ref) ? (ref[ref.length - 1] ?? ref[0]) : ref
}

function useFieldRefLabel(ref: WidgetFieldRef | null | undefined): string | undefined {
  const field = useField(ref ? leafRef(ref) : null)
  return field?.label
}

export function FieldRefPicker({
  source,
  value,
  onChange,
  filterField,
  placeholder = 'Select a field…',
  onClear,
  width = 280,
}: {
  source: WidgetSource
  value: WidgetFieldRef | null | undefined
  onChange: (ref: WidgetFieldRef) => void
  /** Restrict which fields are selectable (relationships still drill). */
  filterField?: (field: ResourceField) => boolean
  placeholder?: string
  onClear?: () => void
  width?: number
}) {
  const label = useFieldRefLabel(value)
  return (
    <FieldPicker
      entityDefinitionId={sourceResourceId(source)}
      filterField={filterField}
      width={width}
      onSelect={(fieldReference) => onChange(fieldReference as WidgetFieldRef)}
      trigger={
        <PickerTrigger
          hasValue={!!value}
          placeholder={placeholder}
          showClear={!!onClear}
          className='w-full ps-0 pe-1'
          onClear={(e) => {
            e.stopPropagation()
            onClear?.()
          }}>
          <span className='truncate text-sm'>{label ?? (value ? 'Field' : placeholder)}</span>
        </PickerTrigger>
      }
    />
  )
}

/** A labeled FieldPanelRow wrapping {@link FieldRefPicker}. */
export function FieldRefRow({
  title,
  description,
  isRequired,
  ...picker
}: {
  title: string
  description?: string
  isRequired?: boolean
} & React.ComponentProps<typeof FieldRefPicker>) {
  return (
    <FieldPanelRow title={title} description={description} isRequired={isRequired}>
      <FieldRefPicker {...picker} />
    </FieldPanelRow>
  )
}
