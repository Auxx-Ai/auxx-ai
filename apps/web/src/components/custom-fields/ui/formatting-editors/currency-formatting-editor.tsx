// apps/web/src/components/custom-fields/ui/formatting-editors/currency-formatting-editor.tsx
'use client'

import type { CurrencyFieldOptions } from '@auxx/lib/field-values/client'
import { Field, FieldGroup, FieldLabel } from '@auxx/ui/components/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { CurrencyPicker } from '~/components/pickers/currency-picker'

interface CurrencyFormattingEditorProps {
  options: CurrencyFieldOptions
  onChange: (options: CurrencyFieldOptions) => void
}

/**
 * Editor for currency field display options.
 * Controls currency code, currency display, decimals, and grouping.
 * Decimals + Grouping are hidden when the display mode is 'compact'
 * (Intl picks fraction digits and disables grouping in compact mode).
 * Used by both the field-default config dialog and column-formatting overrides.
 */
export function CurrencyFormattingEditor({ options, onChange }: CurrencyFormattingEditorProps) {
  const current: Required<CurrencyFieldOptions> = {
    currencyCode: options.currencyCode ?? 'USD',
    decimals: options.decimals ?? 2,
    useGrouping: options.useGrouping ?? true,
    currencyDisplay: options.currencyDisplay ?? 'symbol',
  }
  const isCompact = current.currencyDisplay === 'compact'

  return (
    <FieldGroup className='gap-3'>
      <Field>
        <FieldLabel>Currency</FieldLabel>
        <CurrencyPicker
          selected={current.currencyCode}
          onChange={(code) => onChange({ ...current, currencyCode: code })}
        />
      </Field>

      <Field>
        <FieldLabel>Currency Display</FieldLabel>
        <Select
          value={current.currencyDisplay}
          onValueChange={(v) =>
            onChange({
              ...current,
              currencyDisplay: v as 'symbol' | 'code' | 'name' | 'compact',
            })
          }>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='symbol'>Symbol ($10.99)</SelectItem>
            <SelectItem value='code'>Code (USD 10.99)</SelectItem>
            <SelectItem value='name'>Name (10.99 US dollars)</SelectItem>
            <SelectItem value='compact'>Compact ($1.5B)</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {!isCompact && (
        <Field>
          <FieldLabel>Decimal Places</FieldLabel>
          <Select
            value={String(current.decimals)}
            onValueChange={(v) => onChange({ ...current, decimals: parseInt(v, 10) })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='0'>No decimals (11)</SelectItem>
              <SelectItem value='2'>Two decimal places (10.99)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}

      {!isCompact && (
        <Field>
          <FieldLabel>Thousand Separators</FieldLabel>
          <Select
            value={current.useGrouping ? 'yes' : 'no'}
            onValueChange={(v) => onChange({ ...current, useGrouping: v === 'yes' })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='yes'>With separators (1,000.00)</SelectItem>
              <SelectItem value='no'>No separators (1000.00)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}
    </FieldGroup>
  )
}
