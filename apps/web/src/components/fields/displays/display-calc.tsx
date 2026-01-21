// apps/web/src/components/fields/displays/display-calc.tsx
'use client'

import { useMemo } from 'react'
import DisplayWrapper from './display-wrapper'
import { useFieldContext } from './display-field'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { AlertCircle } from 'lucide-react'
import type { CalcOptions } from '@auxx/lib/custom-fields/client'
import { converters, type NumberFieldOptions } from '@auxx/lib/field-values/client'
import { formatCurrency, type CurrencyDisplayOptions } from '@auxx/utils'

/**
 * DisplayCalc component.
 * Renders a calculated field value that is pre-computed by the computed value middleware.
 * Formats the value based on resultFieldType using the same formatters as Display* components.
 */
export function DisplayCalc() {
  const { field, value } = useFieldContext()
  const calcOptions = field.options?.calc as CalcOptions | undefined

  // Check if field is disabled
  if (calcOptions?.disabled) {
    return (
      <DisplayWrapper>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1 text-muted-foreground italic">
              <AlertCircle className="size-3" />
              Calculation unavailable
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {calcOptions.disabledReason || 'This calculated field has been disabled'}
          </TooltipContent>
        </Tooltip>
      </DisplayWrapper>
    )
  }

  // Value is already computed by useFieldValue/PropertyProvider
  if (value == null) {
    return <DisplayWrapper className="text-muted-foreground">-</DisplayWrapper>
  }

  // Format based on result field type using the same formatters as Display* components
  const { displayValue, copyValue } = useMemo(() => {
    const resultType = calcOptions?.resultFieldType ?? 'TEXT'

    switch (resultType) {
      case 'NUMBER': {
        const num = typeof value === 'number' ? value : parseFloat(String(value))
        if (isNaN(num)) return { displayValue: String(value), copyValue: String(value) }

        // Use NUMBER converter with options from calc config
        const numberOpts = field.options?.number as NumberFieldOptions | undefined
        const typedValue = { type: 'number' as const, value: num }
        const formatted = converters.NUMBER.toDisplayValue(typedValue, numberOpts)
        return { displayValue: formatted, copyValue: String(num) }
      }

      case 'CURRENCY': {
        const currencyOpts: CurrencyDisplayOptions = field.options?.currency || {
          currencyCode: 'USD',
          decimalPlaces: 'two-places',
          displayType: 'symbol',
          groups: 'default',
        }
        const formatted = formatCurrency(value, currencyOpts)
        // For copy, use plain number format (dollars, not cents)
        const copyVal =
          value != null
            ? (Number(value) / 100).toFixed(currencyOpts.decimalPlaces === 'no-decimal' ? 0 : 2)
            : null
        return { displayValue: formatted ?? '-', copyValue: copyVal }
      }

      case 'CHECKBOX':
        return { displayValue: value ? 'Yes' : 'No', copyValue: value ? 'Yes' : 'No' }

      case 'TEXT':
      default:
        return { displayValue: String(value), copyValue: String(value) }
    }
  }, [value, calcOptions?.resultFieldType, field.options])

  return <DisplayWrapper copyValue={copyValue}>{displayValue}</DisplayWrapper>
}
