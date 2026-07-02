// apps/web/src/components/record-rules/ui/record-rule-field-ref-input.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import type { ResourceField } from '@auxx/lib/resources/client'
import { cn } from '@auxx/ui/lib/utils'
import { useMemo } from 'react'
import { FieldPicker } from '~/components/pickers/field-picker/field-picker'
import { PickerTrigger } from '~/components/ui/picker-trigger'

/**
 * The ref format the record-rule router expects: `systemAttribute` when present
 * (resolves in any org), otherwise the field row id.
 */
export function fieldRefFor(field: ResourceField): string {
  return field.systemAttribute ?? String(field.id)
}

interface RecordRuleFieldRefInputProps {
  /** Record type whose fields are offered. */
  entityDefinitionId: string
  /** The record type's fields — used to resolve the current ref's display label. */
  fields: ResourceField[]
  /** Current field ref (`systemAttribute` or row id). */
  value: string
  onChange: (ref: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

/**
 * A `FieldPicker`-backed input for choosing a direct field on a record type,
 * rendered as a {@link PickerTrigger} so it sits flush inside a `FieldPanelRow`.
 * Relationship fields are filtered out (no drill-down) — the rule engine watches a
 * field on the record itself, so refs are always flat (id | systemAttribute).
 */
export function RecordRuleFieldRefInput({
  entityDefinitionId,
  fields,
  value,
  onChange,
  placeholder = 'Select field…',
  disabled,
  className,
}: RecordRuleFieldRefInputProps) {
  const label = useMemo(() => {
    if (!value) return null
    return fields.find((f) => fieldRefFor(f) === value)?.label ?? value
  }, [value, fields])

  return (
    <FieldPicker
      entityDefinitionId={entityDefinitionId}
      filterField={(f) => f.fieldType !== FieldType.RELATIONSHIP}
      onSelect={(_ref, field) => onChange(fieldRefFor(field))}
      trigger={
        <PickerTrigger
          hasValue={!!value}
          placeholder={placeholder}
          disabled={disabled || !entityDefinitionId}
          className={cn('w-full ps-0 pe-1', className)}>
          {label && <span className='truncate text-sm'>{label}</span>}
        </PickerTrigger>
      }
    />
  )
}
