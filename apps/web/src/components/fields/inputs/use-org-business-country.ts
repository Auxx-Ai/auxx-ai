// apps/web/src/components/fields/inputs/use-org-business-country.ts

import { useSettings } from '~/hooks/use-settings'

/**
 * Reads the org's business-address country (`documents.business.address.country`) as the
 * address parser/formatter's domestic default (decision #8 in
 * plans/address-field/01-single-input-address-field.md); falls back to `'US'` when unset.
 * Shared by the single-input address field (drawer) and the workflow/FieldPanel `AddressInput`.
 */
export function useOrgBusinessCountry(): string {
  const { getSetting } = useSettings({})
  const business = getSetting('documents.business')
  const address =
    business && typeof business === 'object'
      ? (business as { address?: { country?: string } }).address
      : undefined
  return address?.country || 'US'
}
