// apps/web/src/components/custom-fields/ui/formatting-editors/time-formatting-editor.tsx
'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { FieldGroup, Field, FieldLabel } from '@auxx/ui/components/field'
import type { DateFieldOptions } from '@auxx/lib/field-values/client'

/** Props for TimeFormattingEditor */
interface TimeFormattingEditorProps {
  options: DateFieldOptions
  onChange: (options: DateFieldOptions) => void
}

/**
 * Editor for TIME field display options.
 * Controls time format (12h or 24h).
 */
export function TimeFormattingEditor({ options, onChange }: TimeFormattingEditorProps) {
  const current: DateFieldOptions = {
    timeFormat: options.timeFormat ?? '12h',
  }

  return (
    <FieldGroup className="gap-3">
      <Field>
        <FieldLabel>Time Format</FieldLabel>
        <Select
          value={current.timeFormat ?? '12h'}
          onValueChange={(v) =>
            onChange({ ...current, timeFormat: v as DateFieldOptions['timeFormat'] })
          }>
          <SelectTrigger>
            <SelectValue placeholder="Select time format" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="12h">12-hour (2:30 PM)</SelectItem>
            <SelectItem value="24h">24-hour (14:30)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </FieldGroup>
  )
}
