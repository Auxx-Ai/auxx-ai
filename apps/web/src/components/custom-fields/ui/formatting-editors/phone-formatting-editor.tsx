// apps/web/src/components/custom-fields/ui/formatting-editors/phone-formatting-editor.tsx
'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { FieldGroup, Field, FieldLabel } from '@auxx/ui/components/field'
import type { PhoneFieldOptions } from '@auxx/lib/field-values/client'
import { Badge } from '@auxx/ui/components/badge'

/** Props for PhoneFormattingEditor */
interface PhoneFormattingEditorProps {
  options: PhoneFieldOptions
  onChange: (options: PhoneFieldOptions) => void
}

/**
 * Editor for phone field display options.
 * Controls phone number formatting style.
 */
export function PhoneFormattingEditor({ options, onChange }: PhoneFormattingEditorProps) {
  const current: PhoneFieldOptions = {
    phoneFormat: options.phoneFormat ?? 'national',
  }

  return (
    <FieldGroup className="gap-3">
      <Field>
        <FieldLabel>Phone Format</FieldLabel>
        <Select
          value={current.phoneFormat}
          onValueChange={(v) =>
            onChange({ ...current, phoneFormat: v as PhoneFieldOptions['phoneFormat'] })
          }>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="national">
              <div className="gap-2 flex flex-row items-center py-0.5 pe-0.5">
                National{' '}
                <Badge variant="pill" size="sm">
                  (415) 555-1234
                </Badge>
              </div>
            </SelectItem>
            <SelectItem value="international">
              <div className="gap-2 flex flex-row items-center py-0.5 pe-0.5">
                International{' '}
                <Badge variant="pill" size="sm">
                  +1 415 555 1234
                </Badge>
              </div>
            </SelectItem>
            <SelectItem value="raw">
              <div className="gap-2 flex flex-row items-center py-0.5 pe-0.5">
                Unformatted{' '}
                <Badge variant="pill" size="sm">
                  +14155551234
                </Badge>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </FieldGroup>
  )
}
