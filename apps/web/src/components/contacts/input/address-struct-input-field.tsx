'use client'

// apps/web/src/components/contacts/input/address-struct-input-field.tsx
import { useState, useCallback, useEffect } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { Input, inputVariants } from '@auxx/ui/components/input'
import { cn } from '@auxx/ui/lib/utils'
import { Combobox } from '@auxx/ui/components/combobox'
import { countries } from '~/constants/countries'
import { usePropertyContext } from '../drawer/property-provider'

/**
 * AddressStruct interface - structured address data
 * Matches ADDRESS_COMPONENTS: street1, street2, city, state, zipCode, country
 */
export interface AddressStruct {
  street1: string
  street2: string
  city: string
  state: string
  zipCode: string
  country: string
}

/**
 * Props for the shared AddressStructFields component
 */
interface AddressStructFieldsProps {
  /** Current address value */
  value: AddressStruct
  /** Callback when any field changes */
  onChange: (address: AddressStruct) => void
  /** Whether the fields are disabled */
  disabled?: boolean
  /** Whether to auto-focus the first field */
  autoFocus?: boolean
  /** Optional class name for the container */
  className?: string
}

/**
 * Shared address fields component - pure UI with no context dependencies
 * Used by both AddressStructInputField (contact drawer) and AddressInput (workflow nodes)
 */
export function AddressStructFields({
  value,
  onChange,
  disabled = false,
  autoFocus = false,
  className = 'flex w-[350px] flex-col gap-2 p-2',
}: AddressStructFieldsProps) {

  /** Handle field change */
  const handleFieldChange = useCallback(
    (fieldName: keyof AddressStruct, fieldValue: string) => {
      onChange({ ...value, [fieldName]: fieldValue })
    },
    [value, onChange]
  )
  return (
    <div className={className}>
      {/* Street Address - full width */}
      <Input
        size="sm"
        placeholder="Street address"
        value={value.street1}
        onChange={(e) => handleFieldChange('street1', e.target.value)}
        disabled={disabled}
        autoFocus={autoFocus}
      />

      {/* Apartment/Suite - full width */}
      <Input
        size="sm"
        placeholder="Apartment, suite, etc. (optional)"
        value={value.street2}
        onChange={(e) => handleFieldChange('street2', e.target.value)}
        disabled={disabled}
      />

      {/* City and State - side by side */}
      <div className="flex gap-2">
        <Input
          size="sm"
          className="min-w-0 flex-1"
          placeholder="City"
          value={value.city}
          onChange={(e) => handleFieldChange('city', e.target.value)}
          disabled={disabled}
        />
        <Input
          size="sm"
          className="w-24"
          placeholder="State"
          value={value.state}
          onChange={(e) => handleFieldChange('state', e.target.value)}
          disabled={disabled}
        />
      </div>

      {/* ZIP Code and Country - side by side */}
      <div className="flex gap-2">
        <Input
          size="sm"
          className="w-24"
          placeholder="ZIP Code"
          value={value.zipCode}
          onChange={(e) => handleFieldChange('zipCode', e.target.value)}
          disabled={disabled}
        />
        <div className="min-w-0 flex-1">
          <Combobox
            options={countries}
            placeholder="Country"
            emptyText={<span>No countries found</span>}
            value={value.country}
            onChangeValue={(val) => handleFieldChange('country', val)}
            disabled={disabled}
            trigger={
              <button
                type="button"
                disabled={disabled}
                className={cn(
                  inputVariants({ size: 'sm' }),
                  'flex w-full cursor-pointer items-center justify-between',
                  disabled && 'cursor-not-allowed opacity-50'
                )}>
                <span className={cn(!value.country && 'text-primary-500')}>
                  {countries.find((c) => c.value === value.country)?.label || 'Country'}
                </span>
                <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
              </button>
            }
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Parse raw value to AddressStruct, handling legacy field names
 */
function parseAddressValue(value: unknown): AddressStruct {
  const initial = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    string
  >
  return {
    street1: initial.street1 ?? initial.street ?? '',
    street2: initial.street2 ?? '',
    city: initial.city ?? '',
    state: initial.state ?? '',
    zipCode: initial.zipCode ?? initial.postalCode ?? '',
    country: initial.country ?? '',
  }
}

/**
 * Shallow compare two AddressStruct objects
 */
function hasAddressChanged(a: AddressStruct, b: AddressStruct): boolean {
  return (
    a.street1 !== b.street1 ||
    a.street2 !== b.street2 ||
    a.city !== b.city ||
    a.state !== b.state ||
    a.zipCode !== b.zipCode ||
    a.country !== b.country
  )
}

/**
 * AddressStructInputField component for contact drawer
 * Wraps AddressStructFields with PropertyContext integration
 *
 * Pattern E: Save-on-close
 * - Local state for editing
 * - Uses onBeforeClose hook for fire-and-forget save
 * - Does NOT capture arrow keys (allows row navigation)
 */
export function AddressStructInputField() {
  const { value, commitValue, onBeforeClose } = usePropertyContext()

  const initialAddress = parseAddressValue(value)
  const [fields, setFields] = useState<AddressStruct>(initialAddress)

  // Register save handler for popover close - fire-and-forget
  useEffect(() => {
    onBeforeClose.current = () => {
      if (hasAddressChanged(fields, initialAddress)) {
        commitValue(fields)
      }
    }
    return () => {
      onBeforeClose.current = undefined
    }
  }, [onBeforeClose, fields, initialAddress, commitValue])

  return <AddressStructFields value={fields} onChange={setFields} autoFocus />
}
