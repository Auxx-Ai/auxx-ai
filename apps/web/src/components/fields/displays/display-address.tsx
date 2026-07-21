import { type AddressStructValue, formatAddress } from '@auxx/utils/address'
import { useSettings } from '~/hooks/use-settings'
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
      <span className='inline-flex items-center gap-1'>{value}</span>
    </DisplayWrapper>
  )
}

/**
 * DisplayAddressStruct component
 * Renders a structured address from a JSON string or object via the shared canonical
 * formatter (plans/address-field/01-single-input-address-field.md decision #10). The
 * org's business-address country is omitted from the rendered line when it matches.
 */
export function DisplayAddressStruct() {
  const { value } = useFieldContext()
  let address: Partial<AddressStructValue> = {}
  if (typeof value === 'string') {
    try {
      address = JSON.parse(value)
    } catch {
      address = {}
    }
  } else if (typeof value === 'object' && value !== null) {
    address = value as Partial<AddressStructValue>
  }

  const { getSetting } = useSettings({})
  const business = getSetting('documents.business') as { address?: { country?: string } } | null
  const domesticCountry = business?.address?.country
  const formattedAddress = formatAddress(address, { domesticCountry })

  return (
    <DisplayWrapper copyValue={formattedAddress || null}>
      <span className='inline-flex items-center gap-1'>{formattedAddress}</span>
    </DisplayWrapper>
  )
}
