// apps/web/src/components/fields/displays/display-address.tsx

import { type AddressStructValue, formatAddress } from '@auxx/utils/address'
import { useMemo } from 'react'
import { parseAddressComponents } from '~/components/custom-fields/ui/address-component-editor'
import { useSettings } from '~/hooks/use-settings'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'

/** The postal components `formatAddress` renders, in the order it renders them. */
const POSTAL_COMPONENTS = ['street1', 'street2', 'city', 'state', 'zipCode', 'country'] as const

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
 * Drops the components the field's `addressComponents` option turns off, so the rendered line
 * matches what the editor shows. `residential` is an indicator rather than a line of the
 * address, so it never reaches the formatter.
 */
function pickComponents(
  address: Partial<AddressStructValue>,
  components: Set<string>
): Partial<AddressStructValue> {
  const picked: Partial<AddressStructValue> = {}
  for (const key of POSTAL_COMPONENTS) {
    if (components.has(key) && address[key] !== undefined) picked[key] = address[key]
  }
  if (components.has('name') && address.name !== undefined) picked.name = address.name
  return picked
}

/**
 * DisplayAddressStruct component
 * Renders a structured address from a JSON string or object via the shared canonical
 * formatter (plans/address-field/01-single-input-address-field.md decision #10). The
 * org's business-address country is omitted from the rendered line when it matches, and the
 * field's `addressComponents` option decides which components are rendered at all.
 */
export function DisplayAddressStruct() {
  const { field, value } = useFieldContext()
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

  const components = useMemo(
    () => new Set(parseAddressComponents(field?.options)),
    [field?.options]
  )
  const formattedAddress = formatAddress(pickComponents(address, components), {
    domesticCountry,
    include: components.has('name') ? ['name'] : undefined,
  })

  return (
    <DisplayWrapper copyValue={formattedAddress || null}>
      <span className='inline-flex items-center gap-1'>{formattedAddress}</span>
    </DisplayWrapper>
  )
}
