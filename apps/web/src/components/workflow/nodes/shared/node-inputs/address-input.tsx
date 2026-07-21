// apps/web/src/components/workflow/nodes/shared/node-inputs/address-input.tsx

import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { FieldOptions } from '@auxx/lib/field-values/client'
import { useCallback } from 'react'
import {
  AddressSingleFields,
  type AddressStructWithSource,
} from '~/components/fields/inputs/address-single-input-field'
import {
  type AddressStruct,
  AddressStructFields,
} from '~/components/fields/inputs/address-struct-input-field'
import { useOrgBusinessCountry } from '~/components/fields/inputs/use-org-business-country'
import { createNodeInput, type NodeInputProps } from './base-node-input'

/**
 * Props for AddressInput node component
 */
interface AddressInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Placeholder text */
  placeholder?: string
  /** Field-specific options (used for address inputVariant / inputMode) */
  fieldOptions?: FieldOptions
  /** The underlying FieldType — `ADDRESS_STRUCT` branches on `fieldOptions.inputMode`
   *  (decision #4); legacy `ADDRESS` (plain text) stays on the structured fields, untouched
   *  (decision #9). Absent (e.g. the workflow variable/constant editor) also stays untouched. */
  fieldType?: string
}

/**
 * Parse raw value to AddressStruct
 */
function parseAddressValue(value: unknown): AddressStruct {
  const initial = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    string
  >
  return {
    street1: initial.street1 ?? '',
    street2: initial.street2 ?? '',
    city: initial.city ?? '',
    state: initial.state ?? '',
    zipCode: initial.zipCode ?? '',
    country: initial.country ?? '',
  }
}

/**
 * Address input component for workflow nodes / FieldPanel adapter.
 * ADDRESS_STRUCT in single mode (default) uses the shared `AddressSingleFields`; structured
 * mode and legacy plain-text `ADDRESS` keep the existing `AddressStructFields`.
 */
export const AddressInput = createNodeInput<AddressInputProps>(
  ({ inputs, onChange, onError, isLoading, name, fieldOptions, fieldType }) => {
    const value = parseAddressValue(inputs[name])
    const defaultCountry = useOrgBusinessCountry()

    const isAddressStruct = fieldType === FieldTypeEnum.ADDRESS_STRUCT

    /**
     * Handle address change - propagate to parent. For an actual `ADDRESS_STRUCT` field in
     * structured mode, mark `_source: 'structured'` (decision #11) so the server-side
     * normalize hook treats these components as authoritative and only adds lat/lng — legacy
     * plain-text `ADDRESS` (decision #9) and the workflow variable/constant editor (no
     * `fieldType`) stay untouched.
     */
    const handleChange = useCallback(
      (address: AddressStruct) => {
        onError(name, null)
        onChange(name, isAddressStruct ? { ...address, _source: 'structured' } : address)
      },
      [name, onChange, onError, isAddressStruct]
    )

    const handleSingleChange = useCallback(
      (address: AddressStructWithSource) => {
        onError(name, null)
        onChange(name, address)
      },
      [name, onChange, onError]
    )

    const isSingleMode = isAddressStruct && fieldOptions?.inputMode !== 'structured'

    if (isSingleMode) {
      return (
        <AddressSingleFields
          value={value}
          defaultCountry={defaultCountry}
          onAccept={handleSingleChange}
          onDraftChange={handleSingleChange}
          disabled={isLoading}
          className='flex w-full flex-col gap-1 pe-2 py-1'
          inputVariant={fieldOptions?.address?.inputVariant}
        />
      )
    }

    return (
      <AddressStructFields
        value={value}
        onChange={handleChange}
        disabled={isLoading}
        className='flex w-full flex-col gap-1 pe-2 py-1'
        inputVariant={fieldOptions?.address?.inputVariant}
      />
    )
  }
)
