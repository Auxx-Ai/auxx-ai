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
  /** Field-specific options (address inputVariant / inputMode / addressComponents) */
  fieldOptions?: FieldOptions
  /** The underlying FieldType — `ADDRESS_STRUCT` branches on `fieldOptions.inputMode`
   *  (decision #4); legacy `ADDRESS` (plain text) stays on the structured fields, untouched
   *  (decision #9). Absent is the workflow variable/constant editor, which has no `FieldType`
   *  at all and branches on `inputMode` like `ADDRESS_STRUCT` does. */
  fieldType?: string
}

/** The residential indicator's three real states. Anything else is not an answer. */
const RESIDENTIAL_VALUES = new Set(['unknown', 'yes', 'no'])

/**
 * Parse raw value to AddressStruct.
 *
 * 🛑 Every key the struct carries must be listed here. This rebuilds the object
 * from scratch on EVERY render, so a key that is missing is not merely absent
 * from the parse, it is actively deleted from the value the editor round-trips:
 * the child writes it, `onChange` stores it, the next render strips it, and the
 * control snaps back to its default. `name` and `residential` were dropped that
 * way, which presented as a residential picker that could not be moved off
 * "unknown" rather than as anything that looked like data loss.
 *
 * `street2` is the reason the six are spread rather than defaulted to `''`
 * individually: the child components treat `undefined` and `''` alike, but the
 * enum cannot, so `residential` is validated instead of coerced. An unrecognised
 * stored value becomes `undefined` (ask again), never `'no'` (a commercial
 * claim that suppresses a carrier surcharge).
 */
function parseAddressValue(value: unknown): AddressStruct {
  const initial = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >
  const residential = initial.residential
  return {
    street1: asText(initial.street1),
    street2: asText(initial.street2),
    city: asText(initial.city),
    state: asText(initial.state),
    zipCode: asText(initial.zipCode),
    country: asText(initial.country),
    name: asText(initial.name),
    residential:
      typeof residential === 'string' && RESIDENTIAL_VALUES.has(residential)
        ? (residential as AddressStruct['residential'])
        : undefined,
  }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
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

    // Who gets to honour `inputMode`: real `ADDRESS_STRUCT` fields, and the workflow
    // variable/constant editor, which carries no `FieldType` at all. Legacy plain-text
    // `ADDRESS` is deliberately excluded and stays on the structured fields (decision #9).
    const honoursInputMode = fieldType === undefined || isAddressStruct

    // Absent resolves to 'single', matching `parseAddressInputMode`.
    const isSingleMode = honoursInputMode && fieldOptions?.inputMode !== 'structured'

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
          components={fieldOptions?.addressComponents}
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
        components={fieldOptions?.addressComponents}
      />
    )
  }
)
