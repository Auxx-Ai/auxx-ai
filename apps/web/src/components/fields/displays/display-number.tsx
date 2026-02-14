// apps/web/src/components/fields/displays/display-number.tsx

import { converters, type NumberFieldOptions } from '@auxx/lib/field-values/client'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'

/**
 * DisplayNumber component
 * Renders a number value using the numberConverter with options from field.options
 */
export function DisplayNumber() {
  const { value, field } = useFieldContext()
  const opts = field.options as NumberFieldOptions | undefined

  if (value === null || value === undefined) {
    return <DisplayWrapper copyValue={null}>-</DisplayWrapper>
  }

  const num = typeof value === 'number' ? value : parseFloat(String(value))
  if (isNaN(num)) {
    return <DisplayWrapper copyValue={String(value)}>{String(value)}</DisplayWrapper>
  }

  // Use the converter to format the display value
  const typedValue = { type: 'number' as const, value: num }

  const formatted = converters.NUMBER.toDisplayValue(typedValue, opts)

  return <DisplayWrapper copyValue={String(value)}>{formatted}</DisplayWrapper>
}
