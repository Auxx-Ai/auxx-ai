// apps/web/src/components/dashboard/ui/config/config-field-row.tsx
'use client'

// ONE labeled config-input row for the widget config panel (plan 07), modeled on
// `connection-variable-fields.tsx`: a FieldPanelRow + FieldInputAdapter that owns
// the native↔typed value conversion in a single place. Every scalar setting in
// the panel (enum SINGLE_SELECT, CHECKBOX switch, NUMBER, TEXT) renders through
// this — no per-input helper components. Pass the FieldType + options; get back a
// normalized value (boolean / number / string / undefined) matching that type.

import { FieldType } from '@auxx/database/enums'
import type { FieldType as FieldTypeName } from '@auxx/database/types'
import type { FieldOptions } from '@auxx/lib/field-values/client'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanelRow } from '~/components/global/forms/field-panel'

export type ConfigFieldValue = string | number | boolean | undefined

/** Stored value → the native value FieldInputAdapter expects for this FieldType. */
function toNative(fieldType: FieldTypeName, value: ConfigFieldValue): unknown {
  if (fieldType === FieldType.CHECKBOX) return Boolean(value)
  if (fieldType === FieldType.NUMBER) return value ?? null
  return value ?? ''
}

/** FieldInputAdapter's native onChange value → the typed value we store. */
function fromNative(fieldType: FieldTypeName, next: unknown): ConfigFieldValue {
  switch (fieldType) {
    case FieldType.CHECKBOX:
      return Boolean(next)
    case FieldType.NUMBER:
      return next === '' || next == null ? undefined : Number(next)
    case FieldType.SINGLE_SELECT:
      return Array.isArray(next) ? (next[0] ?? undefined) : ((next as string) ?? undefined)
    default:
      return (next as string) ?? ''
  }
}

export function ConfigFieldRow({
  title,
  description,
  fieldType,
  fieldOptions,
  value,
  onChange,
  placeholder,
  isRequired,
  validationError,
}: {
  title: string
  description?: string
  fieldType: FieldTypeName
  fieldOptions?: FieldOptions
  value: ConfigFieldValue
  onChange: (value: ConfigFieldValue) => void
  placeholder?: string
  isRequired?: boolean
  validationError?: string
}) {
  return (
    <FieldPanelRow
      title={title}
      description={description}
      isRequired={isRequired}
      validationError={validationError}>
      <FieldInputAdapter
        fieldType={fieldType}
        fieldOptions={fieldOptions}
        value={toNative(fieldType, value)}
        onChange={(v) => onChange(fromNative(fieldType, v))}
        placeholder={placeholder}
        triggerProps={{ className: 'w-full ps-0 pe-1' }}
      />
    </FieldPanelRow>
  )
}
