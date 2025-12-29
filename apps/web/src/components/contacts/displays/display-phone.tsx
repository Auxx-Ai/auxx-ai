import { usePropertyContext } from '../drawer/property-provider'
import DisplayWrapper from './display-wrapper'
import { Badge } from '@auxx/ui/components/badge'
import { formatPhoneNumber } from 'react-phone-number-input'
import { FieldOptionButton } from './field-option-button'
import { PhoneForwarded } from 'lucide-react'

/**
 * DisplayPhone component
 * Renders a formatted phone number with an icon
 */
export function DisplayPhone() {
  const { value } = usePropertyContext()
  const rawValue = typeof value === 'string' ? value : value ? String(value) : ''
  const formatted = rawValue ? formatPhoneNumber(rawValue) : ''
  const displayText = formatted || rawValue || '-'

  const buttons = [
    <FieldOptionButton key="open" label="Call" href={`tel:${rawValue}`}>
      <PhoneForwarded />
    </FieldOptionButton>,
  ]

  return (
    <DisplayWrapper copyValue={rawValue || null} buttons={buttons}>
      <Badge variant="pill">{displayText}</Badge>
    </DisplayWrapper>
  )
}
