// apps/web/src/components/fields/inputs/use-org-business-country.ts

import { useSettings } from '~/hooks/use-settings'

/**
 * Reads the org's business-address country (`documents.business.address.country`) as the
 * domestic default for locale-sensitive inputs; falls back to `'US'` when unset.
 *
 * Two consumers:
 * - Address — the parser/formatter's domestic default (decision #8 in
 *   `plans/address-field/01-single-input-address-field.md`): the single-input address
 *   field (drawer) and the workflow/FieldPanel `AddressInput`.
 * - Phone — `PhoneInputWithFlag`'s `defaultCountry`, i.e. the country a number typed
 *   without a `+` prefix is parsed as, and the flag the picker opens on.
 *
 * The value is an ISO 3166-1 alpha-2 code (`'US'`, `'DE'`). Consumers that need a
 * narrower type validate it themselves — `PhoneInputWithFlag` falls back to `'US'` for
 * anything `react-phone-number-input` doesn't recognise.
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
