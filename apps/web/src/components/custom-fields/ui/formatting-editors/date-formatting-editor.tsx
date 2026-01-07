// apps/web/src/components/custom-fields/ui/formatting-editors/date-formatting-editor.tsx
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

/** Props for DateFormattingEditor */
interface DateFormattingEditorProps {
  options: DateDisplayOptions
  onChange: (options: DateDisplayOptions) => void
}

/**
 * Editor for DATE field display options.
 * Controls date format preset only (no time options).
 */
export function DateFormattingEditor({ options, onChange }: DateFormattingEditorProps) {
  const current: DateDisplayOptions = {
    format: options.format ?? 'medium',
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
            <SelectItem value="short">Short (12/1/24)</SelectItem>
            <SelectItem value="medium">Medium (Dec 1, 2024)</SelectItem>
            <SelectItem value="long">Long (December 1, 2024)</SelectItem>
            <SelectItem value="relative">Relative (2 days ago)</SelectItem>
            <SelectItem value="iso">ISO (2024-12-01)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </FieldGroup>
  )
}
