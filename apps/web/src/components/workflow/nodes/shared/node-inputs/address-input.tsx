// apps/web/src/components/workflow/nodes/shared/node-inputs/address-input.tsx

import { useCallback } from 'react'
import {
  AddressStructFields,
  type AddressStruct,
} from '~/components/fields/inputs/address-struct-input-field'
import { createNodeInput, type NodeInputProps } from './base-node-input'

/**
 * Props for AddressInput node component
 */
interface AddressInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Placeholder text */
  placeholder?: string
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
 * Address input component for workflow nodes
 * Uses shared AddressStructFields component
 */
export const AddressInput = createNodeInput<AddressInputProps>(
  ({ inputs, onChange, onError, isLoading, name }) => {
    const value = parseAddressValue(inputs[name])

    /**
     * Handle address change - propagate to parent
     */
    const handleChange = useCallback(
      (address: AddressStruct) => {
        onError(name, null)
        onChange(name, address)
      },
      [name, onChange, onError]
    )
    return (
      <AddressStructFields
        value={value}
        onChange={handleChange}
        disabled={isLoading}
        className="flex w-full flex-col gap-1 pe-2 py-1"
      />
    )
  }
)
