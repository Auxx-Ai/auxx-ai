// apps/web/src/components/money/ui/settings/business-address-fields.tsx
'use client'

import {
  type AddressStruct,
  AddressStructFields,
} from '~/components/fields/inputs/address-struct-input-field'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'

/** A business tax id label/value pair (e.g. `{ label: 'EIN', value: '12-3456789' }`). */
export interface BusinessTaxId {
  label: string
  value: string
}

export const EMPTY_TAX_ID: BusinessTaxId = { label: '', value: '' }

/** `documents.business` JSON blob shape — address is the canonical `AddressStruct`. */
export interface BusinessInfo {
  companyName: string
  address: AddressStruct
  phone: string
  email: string
  website: string
  taxId: BusinessTaxId
}

/** Map a stored address blob (new `AddressStruct` or the legacy `{line1,line2,region,zip}`) to `AddressStruct`. */
export function normalizeAddress(raw: unknown): AddressStruct {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, string>
  return {
    street1: s.street1 ?? s.line1 ?? '',
    street2: s.street2 ?? s.line2 ?? '',
    city: s.city ?? '',
    state: s.state ?? s.region ?? '',
    zipCode: s.zipCode ?? s.zip ?? '',
    country: s.country ?? '',
  }
}

/** Merge a stored (possibly partial/old-shape) `documents.business` value with defaults so the form never crashes on a fresh org. */
export function normalizeBusiness(raw: unknown): BusinessInfo {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<BusinessInfo>
  return {
    companyName: source.companyName ?? '',
    address: normalizeAddress(source.address),
    phone: source.phone ?? '',
    email: source.email ?? '',
    website: source.website ?? '',
    taxId: { ...EMPTY_TAX_ID, ...(source.taxId ?? {}) },
  }
}

export interface BusinessAddressFieldsProps {
  value: AddressStruct
  onChange: (next: AddressStruct) => void
}

/**
 * The shared `documents.business.address` form row — used by both the Documents settings page
 * (`documents-page.tsx`) and the dispatch setup wizard's Business address page, so the two
 * surfaces stay in lockstep on the same `AddressStruct` shape. Presentational only: the caller
 * owns reading/writing the `documents.business` setting and passes just the `address` slice.
 */
export function BusinessAddressFields({ value, onChange }: BusinessAddressFieldsProps) {
  return (
    <FieldPanelRow title='Address' type={BaseType.ADDRESS} showIcon>
      <div className='py-2'>
        <AddressStructFields value={value} onChange={onChange} className='flex flex-col gap-2' />
      </div>
    </FieldPanelRow>
  )
}
