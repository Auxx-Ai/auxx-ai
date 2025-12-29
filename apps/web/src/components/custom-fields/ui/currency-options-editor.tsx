// apps/web/src/components/custom-fields/ui/currency-options-editor.tsx
'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { FieldGroup, Field, FieldLabel } from '@auxx/ui/components/field'
import { CurrencyPicker } from '~/components/pickers/currency-picker'
import type { CurrencyOptions } from '@auxx/lib/custom-fields/types'

/** Props for CurrencyOptionsEditor component */
interface CurrencyOptionsEditorProps {
  options: CurrencyOptions
  onChange: (options: CurrencyOptions) => void
}

/**
 * CurrencyOptionsEditor component
 * Configures currency field options: currency code, decimal places, display type, and grouping
 */
export function CurrencyOptionsEditor({ options, onChange }: CurrencyOptionsEditorProps) {
  /**
   * Handle individual option changes
   */
  const handleChange = (key: keyof CurrencyOptions, value: string) => {
    onChange({ ...options, [key]: value })
  }

  return (
    <div className="rounded-xl border py-3 px-3 bg-primary-50 space-y-4">
      <FieldGroup className="gap-3">
        {/* Currency Code - Using CurrencyPicker */}
        <Field>
          <FieldLabel>Currency</FieldLabel>
          <CurrencyPicker
            selected={options.currencyCode || 'USD'}
            onChange={(code) => handleChange('currencyCode', code)}
          />
        </Field>

        {/* Decimal Places */}
        <Field>
          <FieldLabel>Decimal Places</FieldLabel>
          <Select
            value={options.decimalPlaces || 'two-places'}
            onValueChange={(v) => handleChange('decimalPlaces', v as 'two-places' | 'no-decimal')}>
            <SelectTrigger>
              <SelectValue placeholder="Select decimal format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="two-places">Two decimal places (10.99)</SelectItem>
              <SelectItem value="no-decimal">No decimals (11)</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {/* Display Type */}
        <Field>
          <FieldLabel>Currency Display</FieldLabel>
          <Select
            value={options.displayType || 'symbol'}
            onValueChange={(v) => handleChange('displayType', v as 'symbol' | 'name' | 'code')}>
            <SelectTrigger>
              <SelectValue placeholder="Select display format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="symbol">Symbol ($10.99)</SelectItem>
              <SelectItem value="code">Code (USD 10.99)</SelectItem>
              <SelectItem value="name">Name (10.99 US dollars)</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {/* Thousand Separators */}
        <Field>
          <FieldLabel>Thousand Separators</FieldLabel>
          <Select
            value={options.groups || 'default'}
            onValueChange={(v) => handleChange('groups', v as 'default' | 'no-groups')}>
            <SelectTrigger>
              <SelectValue placeholder="Select grouping" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">With separators (1,000.00)</SelectItem>
              <SelectItem value="no-groups">No separators (1000.00)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
    </div>
  )
}
