// apps/web/src/components/custom-fields/ui/formatting-editors/boolean-formatting-editor.tsx
'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Input } from '@auxx/ui/components/input'
import { FieldGroup, Field, FieldLabel } from '@auxx/ui/components/field'
import type { BooleanFieldOptions } from '@auxx/lib/field-values/client'

/** Props for BooleanFormattingEditor */
interface BooleanFormattingEditorProps {
  options: BooleanFieldOptions
  onChange: (options: BooleanFieldOptions) => void
}

/**
 * Editor for CHECKBOX field display options.
 * Controls display style (icon, text, or both) and custom labels.
 */
export function BooleanFormattingEditor({ options, onChange }: BooleanFormattingEditorProps) {
  const current: BooleanFieldOptions = {
    checkboxStyle: options.checkboxStyle ?? 'icon-text',
    trueLabel: options.trueLabel ?? 'True',
    falseLabel: options.falseLabel ?? 'False',
  }

  return (
    <FieldGroup className="gap-3">
      <Field>
        <FieldLabel>Display Style</FieldLabel>
        <Select
          value={current.checkboxStyle ?? 'icon-text'}
          onValueChange={(v) =>
            onChange({ ...current, checkboxStyle: v as BooleanFieldOptions['checkboxStyle'] })
          }>
          <SelectTrigger>
            <SelectValue placeholder="Select display style" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="icon-text">Icon with text</SelectItem>
            <SelectItem value="icon">Icon only</SelectItem>
            <SelectItem value="text">Text only</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel>Label for True</FieldLabel>
        <Input
          value={current.trueLabel ?? 'True'}
          onChange={(e) => onChange({ ...current, trueLabel: e.target.value })}
          placeholder="True"
        />
      </Field>

      <Field>
        <FieldLabel>Label for False</FieldLabel>
        <Input
          value={current.falseLabel ?? 'False'}
          onChange={(e) => onChange({ ...current, falseLabel: e.target.value })}
          placeholder="False"
        />
      </Field>
    </FieldGroup>
  )
}
