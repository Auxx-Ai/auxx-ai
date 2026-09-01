// apps/web/src/components/fields/displays/display-currency.tsx
'use client'

import {
  type CurrencyFieldOptions,
  readCurrency,
  resolveCurrencyCode,
} from '@auxx/lib/field-values/client'
import {
  type CurrencyDisplayOptions,
  formatCurrency,
  minorToMajorString,
} from '@auxx/utils/currency'
import { useMemo } from 'react'
import { useOrgCurrency } from '~/hooks/use-org-currency'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'

/**
 * DisplayCurrency component
 * Renders a currency value with proper formatting based on field options
 */
export function DisplayCurrency() {
  const { value, field } = useFieldContext()
  const orgCurrency = useOrgCurrency()

  const amount = useMemo(() => readCurrency(value), [value])

  const options: CurrencyDisplayOptions = useMemo(() => {
    const opts = field.options as CurrencyFieldOptions | undefined
    return {
      // field → org → USD. A value never asserts its own.
      currencyCode: resolveCurrencyCode(opts?.currencyCode, orgCurrency),
      // Undefined derives the fraction digits from the code (JPY 0, KWD 3).
      decimals: opts?.decimals,
      useGrouping: opts?.useGrouping ?? true,
      currencyDisplay: opts?.currencyDisplay ?? 'symbol',
    }
  }, [field.options, orgCurrency])

  const formattedValue = useMemo(
    () => (amount === null ? null : formatCurrency(amount, options)),
    [amount, options]
  )

  // For copy, use the plain major-unit number — no symbol, no grouping, so it
  // round-trips back into an input. Full stored precision: omitting `decimals`
  // here would silently truncate a fractional-cent rate to the copied text.
  const copyValue =
    amount === null ? null : minorToMajorString(amount, options.currencyCode, options.decimals)

  return <DisplayWrapper copyValue={copyValue}>{formattedValue || '-'}</DisplayWrapper>
}
