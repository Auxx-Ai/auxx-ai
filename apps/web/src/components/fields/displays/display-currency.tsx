// apps/web/src/components/fields/displays/display-currency.tsx
'use client'

import type { CurrencyFieldOptions } from '@auxx/lib/field-values/client'
import { type CurrencyDisplayOptions, formatCurrency } from '@auxx/utils'
import { useMemo } from 'react'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'

/**
 * DisplayCurrency component
 * Renders a currency value with proper formatting based on field options
 */
export function DisplayCurrency() {
  const { value, field } = useFieldContext()

  const options: CurrencyDisplayOptions = useMemo(() => {
    const opts = field.options as CurrencyFieldOptions | undefined
    return {
      currencyCode: opts?.currencyCode ?? 'USD',
      decimals: opts?.decimals ?? 2,
      useGrouping: opts?.useGrouping ?? true,
      currencyDisplay: opts?.currencyDisplay ?? 'symbol',
    }
  }, [field.options])

  const formattedValue = useMemo(() => {
    if (value === null || value === undefined) return null
    return formatCurrency(value, options)
  }, [value, options])

  // For copy, use the plain number format (dollars, not cents)
  const copyValue =
    value !== null && value !== undefined ? (value / 100).toFixed(options.decimals ?? 2) : null

  return <DisplayWrapper copyValue={copyValue}>{formattedValue || '-'}</DisplayWrapper>
}
