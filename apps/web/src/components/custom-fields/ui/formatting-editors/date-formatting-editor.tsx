// apps/web/src/components/custom-fields/ui/formatting-editors/date-formatting-editor.tsx
'use client'

import type { DateFieldOptions } from '@auxx/lib/field-values/client'
import { Field, FieldGroup, FieldLabel } from '@auxx/ui/components/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'

/** Props for DateFormattingEditor */
interface DateFormattingEditorProps {
  options: DateFieldOptions
  onChange: (options: DateFieldOptions) => void
}

/**
 * Editor for DATE field display options.
 * Controls date format preset only (no time options).
 */
export function DateFormattingEditor({ options, onChange }: DateFormattingEditorProps) {
  const current: DateFieldOptions = {
    format: options.format ?? 'medium',
  }

  return (
    <FieldGroup className='gap-3'>
      <Field>
        <FieldLabel>Date Format</FieldLabel>
        <Select
          value={current.format ?? 'medium'}
          onValueChange={(v) => onChange({ ...current, format: v as DateFieldOptions['format'] })}>
          <SelectTrigger>
            <SelectValue placeholder='Select date format' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='short'>Short (12/1/24)</SelectItem>
            <SelectItem value='medium'>Medium (Dec 1, 2024)</SelectItem>
            <SelectItem value='long'>Long (December 1, 2024)</SelectItem>
            <SelectItem value='relative'>Relative (2 days ago)</SelectItem>
            <SelectItem value='iso'>ISO (2024-12-01)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </FieldGroup>
  )
}
