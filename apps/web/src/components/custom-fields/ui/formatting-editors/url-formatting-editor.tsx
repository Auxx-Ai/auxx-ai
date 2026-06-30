// apps/web/src/components/custom-fields/ui/formatting-editors/url-formatting-editor.tsx
'use client'

import type { FieldOptions } from '@auxx/lib/field-values/client'
import { Field, FieldGroup, FieldLabel } from '@auxx/ui/components/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'

/** Props for UrlFormattingEditor */
interface UrlFormattingEditorProps {
  options: Pick<FieldOptions, 'urlDisplay'>
  onChange: (options: { urlDisplay: 'link' | 'image' }) => void
}

/**
 * Editor for URL field display options.
 * Controls whether the value renders as a clickable link or an image thumbnail
 * (e.g. for product images or avatar URLs).
 */
export function UrlFormattingEditor({ options, onChange }: UrlFormattingEditorProps) {
  const urlDisplay = options.urlDisplay ?? 'link'

  return (
    <FieldGroup className='gap-3'>
      <Field>
        <FieldLabel>Display As</FieldLabel>
        <Select
          value={urlDisplay}
          onValueChange={(v) => onChange({ urlDisplay: v as 'link' | 'image' })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='link'>Link</SelectItem>
            <SelectItem value='image'>Image</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </FieldGroup>
  )
}
