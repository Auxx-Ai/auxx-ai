// apps/web/src/components/custom-fields/ui/formatting-editors/number-formatting-editor.tsx
'use client'

import type { NumberFieldOptions } from '@auxx/lib/field-values/client'
import { Field, FieldGroup, FieldLabel } from '@auxx/ui/components/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'

/** Props for NumberFormattingEditor */
interface NumberFormattingEditorProps {
  options: NumberFieldOptions
  onChange: (options: NumberFieldOptions) => void
}

/**
 * Editor for number field display options.
 * Controls decimal places, grouping, display format, prefix/suffix.
 */
export function NumberFormattingEditor({ options, onChange }: NumberFormattingEditorProps) {
  const current: NumberFieldOptions = {
    decimals: options.decimals ?? 0,
    useGrouping: options.useGrouping ?? true,
    displayAs: options.displayAs ?? 'number',
    prefix: options.prefix ?? '',
    suffix: options.suffix ?? '',
  }

  return (
    <FieldGroup className='gap-3'>
      <Field>
        <FieldLabel>Decimal Places</FieldLabel>
        <Select
          value={String(current.decimals)}
          onValueChange={(v) => onChange({ ...current, decimals: parseInt(v, 10) })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='0'>0 (1234)</SelectItem>
            <SelectItem value='1'>1 (1234.5)</SelectItem>
            <SelectItem value='2'>2 (1234.56)</SelectItem>
            <SelectItem value='3'>3 (1234.567)</SelectItem>
            <SelectItem value='4'>4 (1234.5678)</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel>Thousand Separators</FieldLabel>
        <Select
          value={current.useGrouping ? 'yes' : 'no'}
          onValueChange={(v) => onChange({ ...current, useGrouping: v === 'yes' })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='yes'>With separators (1,234.56)</SelectItem>
            <SelectItem value='no'>No separators (1234.56)</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel>Display As</FieldLabel>
        <Select
          value={current.displayAs ?? 'number'}
          onValueChange={(v) =>
            onChange({ ...current, displayAs: v as NumberFieldOptions['displayAs'] })
          }>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='number'>Number (1234.56)</SelectItem>
            <SelectItem value='percentage'>Percentage (12.35%)</SelectItem>
            <SelectItem value='compact'>Compact (1.2K)</SelectItem>
            <SelectItem value='bytes'>Bytes (1.21 KB)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </FieldGroup>
  )
}
