// apps/web/src/components/fields/displays/display-phone.tsx

import { usePropertyContext } from '../property-provider'
import DisplayWrapper from './display-wrapper'
import { Badge } from '@auxx/ui/components/badge'
import { FieldOptionButton } from './field-option-button'
import { PhoneForwarded } from 'lucide-react'
import { formatToDisplayValue } from '@auxx/lib/field-values/client'

/**
 * DisplayPhone component
 * Renders a formatted phone number with configurable format
 */
export function DisplayPhone() {
  const { value, field } = usePropertyContext()
  const rawValue = typeof value === 'string' ? value : value ? String(value) : ''
  const options = field.options
  // Use converter for display formatting
  const formatted = rawValue
    ? (formatToDisplayValue({ type: 'text', value: rawValue }, 'PHONE_INTL', options) as string)
    : ''

  const displayText = formatted || '-'

  const buttons = [
    <FieldOptionButton key="open" label="Call" href={`tel:${rawValue}`}>
      <PhoneForwarded />
    </FieldOptionButton>,
  ]

  return (
    <DisplayWrapper copyValue={rawValue || null} buttons={buttons}>
      <Badge shape="tag" variant="pill">
        {displayText}
      </Badge>
    </DisplayWrapper>
  )
}
