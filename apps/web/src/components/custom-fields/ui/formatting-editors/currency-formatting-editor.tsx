// apps/web/src/components/custom-fields/ui/formatting-editors/currency-formatting-editor.tsx
'use client'

import type { CurrencyFieldOptions } from '@auxx/lib/field-values/client'
import { Button } from '@auxx/ui/components/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@auxx/ui/components/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { CurrencyPicker } from '~/components/pickers/currency-picker'
import { useOrgCurrency } from '~/hooks/use-org-currency'

interface CurrencyFormattingEditorProps {
  options: CurrencyFieldOptions
  onChange: (options: CurrencyFieldOptions) => void
  /**
   * Where this editor is rendered. `'field'` (the default) owns the
   * denomination and shows the picker; `'column'` shows it read-only, because a
   * column override across exponents rescales the money instead of relabelling
   * it. See `currencyFormattingSchema`.
   */
  scope?: 'field' | 'column'
}

/**
 * Editor for currency field display options.
 * Controls currency code, currency display, decimals, and grouping.
 * Decimals + Grouping are hidden when the display mode is 'compact'
 * (Intl picks fraction digits and disables grouping in compact mode).
 * Used by both the field-default config dialog and column-formatting overrides.
 */
export function CurrencyFormattingEditor({
  options,
  onChange,
  scope = 'field',
}: CurrencyFormattingEditorProps) {
  const orgCurrency = useOrgCurrency()

  // 🛑 `currencyCode` and `decimals` BOTH stay possibly-undefined.
  //
  // An absent code means INHERIT the org's, and it has to stay absent — the
  // moment this seeds the picker with a concrete code, every unrelated edit
  // (change the display mode, change the separators) spreads `current` back
  // through `onChange` and STAMPS it, pinning a field that was following
  // `organization.currency`. Undefined `decimals` likewise means "derive from
  // the code", which is right for JPY (0) and KWD (3), not just USD (2).
  const current: CurrencyFieldOptions = {
    currencyCode: options.currencyCode,
    decimals: options.decimals,
    useGrouping: options.useGrouping ?? true,
    currencyDisplay: options.currencyDisplay ?? 'symbol',
  }
  const isCompact = current.currencyDisplay === 'compact'

  return (
    <FieldGroup className='gap-3'>
      <Field>
        <FieldLabel>Currency</FieldLabel>
        {scope === 'column' ? (
          <p className='text-muted-foreground text-xs'>
            {current.currencyCode ?? orgCurrency} — set on the field. Changing a column's currency
            would rescale the amounts, not just relabel them.
          </p>
        ) : (
          <>
            <CurrencyPicker
              selected={current.currencyCode}
              placeholder={`Organization default (${orgCurrency})`}
              onChange={(code) => onChange({ ...current, currencyCode: code })}
            />
            {current.currencyCode ? (
              <Button
                variant='ghost'
                size='sm'
                className='h-auto self-start px-0 text-muted-foreground text-xs'
                onClick={() => onChange({ ...current, currencyCode: undefined })}>
                Use organization default ({orgCurrency})
              </Button>
            ) : (
              <p className='text-muted-foreground text-xs'>
                Follows the organization currency. Change it in Settings → General.
              </p>
            )}
          </>
        )}
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
            value={current.decimals === undefined ? 'auto' : String(current.decimals)}
            onValueChange={(v) =>
              onChange({ ...current, decimals: v === 'auto' ? undefined : Number.parseInt(v, 10) })
            }>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='auto'>Match the currency (recommended)</SelectItem>
              <SelectItem value='0'>No decimals (11)</SelectItem>
              <SelectItem value='2'>Two decimal places (10.99)</SelectItem>
              <SelectItem value='3'>Three decimal places (10.990)</SelectItem>
              <SelectItem value='4'>Four decimal places (10.9900)</SelectItem>
              <SelectItem value='5'>Five decimal places (10.99000)</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>
            Places a value can carry. Affects what can be entered, not only how it is shown.
          </FieldDescription>
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
