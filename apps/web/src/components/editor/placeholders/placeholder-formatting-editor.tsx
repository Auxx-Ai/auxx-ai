// apps/web/src/components/editor/placeholders/placeholder-formatting-editor.tsx

'use client'

import type { FieldOptions } from '@auxx/lib/field-values/client'
import type { PlaceholderFormatType } from '@auxx/lib/placeholders/client'
import {
  BooleanFormattingEditor,
  CurrencyFormattingEditor,
  DateFormattingEditor,
  DateTimeFormattingEditor,
  NumberFormattingEditor,
  PhoneFormattingEditor,
  TimeFormattingEditor,
  UrlFormattingEditor,
} from '~/components/custom-fields/ui/formatting-editors'

/** Props for the shared per-placeholder display-formatting editor. */
interface PlaceholderFormattingEditorProps {
  /** Field type selecting one of the existing display-option editors. */
  fieldType: PlaceholderFormatType
  /** Effective field options plus any persisted per-placeholder override. */
  options: Partial<FieldOptions>
  /** Persist the display-option override for this placeholder occurrence. */
  onChange: (options: Partial<FieldOptions>) => void
}

/**
 * Reuses the field-formatting controls for a placeholder occurrence.
 *
 * This component deliberately owns no persistence or formatting logic: the
 * badge popover stores the returned partial `FieldOptions` payload, and the
 * server merges it with `FieldValueService` result metadata at render time.
 */
export function PlaceholderFormattingEditor({
  fieldType,
  options,
  onChange,
}: PlaceholderFormattingEditorProps) {
  switch (fieldType) {
    case 'NUMBER':
      return <NumberFormattingEditor options={options} onChange={onChange} />
    case 'CURRENCY':
      return <CurrencyFormattingEditor options={options} onChange={onChange} />
    case 'DATE':
      return <DateFormattingEditor options={options} onChange={onChange} />
    case 'DATETIME':
      return <DateTimeFormattingEditor options={options} onChange={onChange} />
    case 'TIME':
      return <TimeFormattingEditor options={options} onChange={onChange} />
    case 'CHECKBOX':
      return <BooleanFormattingEditor options={options} onChange={onChange} />
    case 'PHONE_INTL':
      return <PhoneFormattingEditor options={options} onChange={onChange} />
    case 'URL':
      return <UrlFormattingEditor options={options} onChange={onChange} />
  }
}
