'use client'

// apps/web/src/components/fields/inputs/address-struct-input-field.tsx
'use client'

import { CountrySelect } from '@auxx/ui/components/country-select'
import { Input } from '@auxx/ui/components/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@auxx/ui/components/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { cn } from '@auxx/ui/lib/utils'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { parseAddressComponents } from '~/components/custom-fields/ui/address-component-editor'
import { usePropertyContext } from '../property-provider'

/**
 * AddressStruct interface - structured address data
 * Matches ADDRESS_COMPONENTS: name, street1, street2, city, state, zipCode, country,
 * residential. `name`/`residential` are opt-in per field via `addressComponents`, so they
 * are optional here and every existing caller keeps compiling unchanged.
 */
export interface AddressStruct {
  street1: string
  street2: string
  city: string
  state: string
  zipCode: string
  country: string
  name?: string
  residential?: 'unknown' | 'yes' | 'no'
}

/** The residential indicator's three real states — `unknown` is not "empty". */
const RESIDENTIAL_OPTIONS: { value: 'unknown' | 'yes' | 'no'; label: string }[] = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'yes', label: 'Residential' },
  { value: 'no', label: 'Commercial' },
]

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
  /** Input variant for address sub-fields */
  inputVariant?: 'default' | 'transparent'
  /**
   * Optional addon rendered inside the street-address input (right-aligned) — the
   * single-input variant passes its expand/collapse toggle button here so it lives in the
   * street line rather than floating above the fields.
   */
  street1Addon?: ReactNode
  /**
   * Sub-fields to render, from the field's `addressComponents` option
   * (see `parseAddressComponents`). Omitted ⇒ the default six, so a caller that has no field
   * options renders exactly as before.
   */
  components?: string[]
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
  inputVariant,
  street1Addon,
  components,
}: AddressStructFieldsProps) {
  /** Handle a text sub-field change. `residential` is an enum, so it has its own handler. */
  const handleFieldChange = useCallback(
    (fieldName: Exclude<keyof AddressStruct, 'residential'>, fieldValue: string) => {
      onChange({ ...value, [fieldName]: fieldValue })
    },
    [value, onChange]
  )

  const handleResidentialChange = useCallback(
    (next: string) => {
      onChange({ ...value, residential: next as AddressStruct['residential'] })
    },
    [value, onChange]
  )

  const shown = useMemo(() => new Set(components ?? parseAddressComponents()), [components])

  // The street line owns `autoFocus` and the expand/collapse addon; when it is hidden they
  // move to whichever field renders first, so the popover still lands on an input and the
  // toggle never disappears.
  const firstVisible = ['name', 'street1', 'street2', 'city', 'state', 'zipCode'].find((id) =>
    shown.has(id)
  )

  return (
    <div className={className}>
      {shown.has('name') && (
        <Input
          size='sm'
          variant={inputVariant}
          placeholder='Name'
          value={value.name ?? ''}
          onChange={(e) => handleFieldChange('name', e.target.value)}
          disabled={disabled}
          autoFocus={autoFocus && firstVisible === 'name'}
        />
      )}

      {/* Street Address - full width; with an addon it becomes an InputGroup so the addon
          button sits inside the input's right edge */}
      {shown.has('street1') &&
        (street1Addon ? (
          <InputGroup
            size='sm'
            className={cn(
              inputVariant === 'transparent' && 'border-transparent bg-transparent shadow-none'
            )}>
            <InputGroupInput
              placeholder='Street address'
              value={value.street1}
              onChange={(e) => handleFieldChange('street1', e.target.value)}
              disabled={disabled}
              autoFocus={autoFocus && firstVisible === 'street1'}
            />
            <InputGroupAddon align='inline-end'>{street1Addon}</InputGroupAddon>
          </InputGroup>
        ) : (
          <Input
            size='sm'
            variant={inputVariant}
            placeholder='Street address'
            value={value.street1}
            onChange={(e) => handleFieldChange('street1', e.target.value)}
            disabled={disabled}
            autoFocus={autoFocus && firstVisible === 'street1'}
          />
        ))}

      {/* The toggle addon lives in the street line; with the street hidden it would vanish
          with it, so render it on its own row instead. */}
      {!shown.has('street1') && street1Addon && (
        <div className='flex justify-end'>{street1Addon}</div>
      )}

      {/* Apartment/Suite - full width */}
      {shown.has('street2') && (
        <Input
          size='sm'
          variant={inputVariant}
          placeholder='Apartment, suite, etc. (optional)'
          value={value.street2}
          onChange={(e) => handleFieldChange('street2', e.target.value)}
          disabled={disabled}
          autoFocus={autoFocus && firstVisible === 'street2'}
        />
      )}

      {/* City and State - side by side; either alone takes the full row */}
      {(shown.has('city') || shown.has('state')) && (
        <div className='flex gap-2'>
          {shown.has('city') && (
            <Input
              size='sm'
              variant={inputVariant}
              className='min-w-0 flex-1'
              placeholder='City'
              value={value.city}
              onChange={(e) => handleFieldChange('city', e.target.value)}
              disabled={disabled}
              autoFocus={autoFocus && firstVisible === 'city'}
            />
          )}
          {shown.has('state') && (
            <Input
              size='sm'
              variant={inputVariant}
              className={shown.has('city') ? 'w-24' : 'min-w-0 flex-1'}
              placeholder='State'
              value={value.state}
              onChange={(e) => handleFieldChange('state', e.target.value)}
              disabled={disabled}
              autoFocus={autoFocus && firstVisible === 'state'}
            />
          )}
        </div>
      )}

      {/* ZIP Code and Country - side by side; either alone takes the full row */}
      {(shown.has('zipCode') || shown.has('country')) && (
        <div className='flex gap-2'>
          {shown.has('zipCode') && (
            <Input
              size='sm'
              variant={inputVariant}
              className={shown.has('country') ? 'w-24' : 'min-w-0 flex-1'}
              placeholder='ZIP Code'
              value={value.zipCode}
              onChange={(e) => handleFieldChange('zipCode', e.target.value)}
              disabled={disabled}
              autoFocus={autoFocus && firstVisible === 'zipCode'}
            />
          )}
          {shown.has('country') && (
            <div className='min-w-0 flex-1'>
              {/* Shared picker: full ISO 3166-1 list, flag on the left, blue selected check.
                  Rows are indexed by country name, so "United" finds both United States and
                  United Kingdom — the previous Combobox indexed the alpha-2 code alone. */}
              <CountrySelect
                value={value.country}
                onChange={(code) => handleFieldChange('country', code)}
                disabled={disabled}
                placeholder='Country'
                variant={inputVariant === 'transparent' ? 'transparent' : 'default'}
                size='sm'
              />
            </div>
          )}
        </div>
      )}

      {shown.has('residential') && (
        <Select
          value={value.residential ?? 'unknown'}
          onValueChange={handleResidentialChange}
          disabled={disabled}>
          <SelectTrigger
            size='sm'
            variant={inputVariant === 'transparent' ? 'transparent' : 'default'}
            aria-label='Residential'>
            <SelectValue placeholder='Residential' />
          </SelectTrigger>
          <SelectContent>
            {RESIDENTIAL_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
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
    name: initial.name ?? '',
    residential: (initial.residential as AddressStruct['residential']) ?? undefined,
  }
}

/**
 * Shallow compare two AddressStruct objects. `name`/`residential` are compared too — without
 * them, editing only the recipient line never reports a change and the commit is dropped.
 */
function hasAddressChanged(a: AddressStruct, b: AddressStruct): boolean {
  return (
    a.street1 !== b.street1 ||
    a.street2 !== b.street2 ||
    a.city !== b.city ||
    a.state !== b.state ||
    a.zipCode !== b.zipCode ||
    a.country !== b.country ||
    (a.name ?? '') !== (b.name ?? '') ||
    a.residential !== b.residential
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
  const { field, value, commitValue, onBeforeClose } = usePropertyContext()

  const initialAddress = parseAddressValue(value)
  const [fields, setFields] = useState<AddressStruct>(initialAddress)
  const components = useMemo(() => parseAddressComponents(field?.options), [field?.options])

  // Register save handler for popover close - fire-and-forget. `_source: 'structured'` marks
  // this as an authoritative structured-editor commit (decision #11 in
  // plans/address-field/01-single-input-address-field.md) — the server-side normalize hook
  // only adds lat/lng and never overwrites these components. `raw` is never part of `fields`
  // (AddressStruct has no such key), so it's already dropped here rather than going stale next
  // to a manual correction (decision #6).
  useEffect(() => {
    onBeforeClose.current = () => {
      if (hasAddressChanged(fields, initialAddress)) {
        commitValue({ ...fields, _source: 'structured' })
      }
    }
    return () => {
      onBeforeClose.current = undefined
    }
  }, [onBeforeClose, fields, initialAddress, commitValue])

  return (
    <AddressStructFields value={fields} onChange={setFields} components={components} autoFocus />
  )
}
