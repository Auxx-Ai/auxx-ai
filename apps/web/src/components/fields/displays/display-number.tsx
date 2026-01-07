// apps/web/src/components/fields/displays/display-number.tsx
import DisplayWrapper from './display-wrapper'
import { usePropertyContext } from '../property-provider'
import { converters, type NumberDisplayOptions } from '@auxx/lib/field-values/client'

/**
 * DisplayNumber component
 * Renders a number value using the numberConverter with options from field.options
 */
export function DisplayNumber() {
  const { value, field } = usePropertyContext()
  const opts = field.options as NumberDisplayOptions | undefined

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

  return (
    <DisplayWrapper copyValue={String(value)}>
      {formatted}
    </DisplayWrapper>
  )
}
