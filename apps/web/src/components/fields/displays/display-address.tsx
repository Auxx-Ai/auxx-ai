import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'

/**
 * DisplayAddress component
 * Renders a simple address string
 */
export function DisplayAddress() {
  const { value } = useFieldContext()
  const copyText = value == null ? '' : String(value)
  return (
    <DisplayWrapper copyValue={copyText || null}>
      <span className="inline-flex items-center gap-1">{value}</span>
    </DisplayWrapper>
  )
}

/**
 * DisplayAddressStruct component
 * Renders a structured address from a JSON string or object
 * Supports both old field names (street, postalCode) and new ones (street1, zipCode)
 */
export function DisplayAddressStruct() {
  const { value } = useFieldContext()
  let address: Record<string, string> = {}
  if (typeof value === 'string') {
    try {
      address = JSON.parse(value)
    } catch {
      address = {}
    }
  } else if (typeof value === 'object' && value !== null) {
    address = value as Record<string, string>
  }

  // Support both old and new field names for backward compatibility
  const street1 = address.street1 || address.street || ''
  const street2 = address.street2 || ''
  const city = address.city || ''
  const state = address.state || ''
  const zipCode = address.zipCode || address.postalCode || ''
  const country = address.country || ''

  // Format: street1, street2, city, state zipCode, country
  const streetPart = [street1, street2].filter(Boolean).join(', ')
  const cityStatePart = [city, [state, zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const parts = [streetPart, cityStatePart, country].filter(Boolean)
  const formattedAddress = parts.join(', ')

  return (
    <DisplayWrapper copyValue={formattedAddress || null}>
      <span className="inline-flex items-center gap-1">{formattedAddress}</span>
    </DisplayWrapper>
  )
}
