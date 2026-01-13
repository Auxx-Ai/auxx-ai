// apps/web/src/components/fields/displays/display-currency.tsx
'use client'

import { useMemo } from 'react'
import DisplayWrapper from './display-wrapper'
import { useFieldContext } from './display-field'
import { formatCurrency, type CurrencyDisplayOptions } from '@auxx/utils'

/**
 * DisplayCurrency component
 * Renders a currency value with proper formatting based on field options
 */
export function DisplayCurrency() {
  const { value, field } = useFieldContext()

  const options: CurrencyDisplayOptions = useMemo(() => {
    return field.options?.currency || {
      currencyCode: 'USD',
      decimalPlaces: 'two-places',
      displayType: 'symbol',
      groups: 'default',
    }
  }, [field.options])

  const formattedValue = useMemo(() => {
    if (value === null || value === undefined) return null
    return formatCurrency(value, options)
  }, [value, options])

  // For copy, use the plain number format (dollars, not cents)
  const copyValue = value !== null && value !== undefined
    ? (value / 100).toFixed(options.decimalPlaces === 'no-decimal' ? 0 : 2)
    : null

  return (
    <DisplayWrapper copyValue={copyValue}>
      {formattedValue || '-'}
    </DisplayWrapper>
  )
}
