// apps/web/src/components/custom-fields/ui/formatting-editors/datetime-formatting-editor.tsx
'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { FieldGroup, Field, FieldLabel } from '@auxx/ui/components/field'
import type { DateDisplayOptions } from '@auxx/lib/field-values/client'

/** Props for DateTimeFormattingEditor */
interface DateTimeFormattingEditorProps {
  options: DateDisplayOptions
  onChange: (options: DateDisplayOptions) => void
}

/**
 * Editor for DATETIME field display options.
 * Controls date format preset. Time is always included for DATETIME fields.
 */
export function DateTimeFormattingEditor({ options, onChange }: DateTimeFormattingEditorProps) {
  const current: DateDisplayOptions = {
    format: options.format ?? 'medium',
    includeTime: true, // Always true for DATETIME
  }

  return (
    <FieldGroup className="gap-3">
      <Field>
        <FieldLabel>Date Format</FieldLabel>
        <Select
          value={current.format ?? 'medium'}
          onValueChange={(v) =>
            onChange({ ...current, format: v as DateDisplayOptions['format'] })
          }>
          <SelectTrigger>
            <SelectValue placeholder="Select date format" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="short">Short (12/1/24 2:30 PM)</SelectItem>
            <SelectItem value="medium">Medium (Dec 1, 2024 2:30 PM)</SelectItem>
            <SelectItem value="long">Long (December 1, 2024 2:30 PM)</SelectItem>
            <SelectItem value="relative">Relative (2 days ago)</SelectItem>
            <SelectItem value="iso">ISO (2024-12-01T14:30:00)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </FieldGroup>
  )
}
