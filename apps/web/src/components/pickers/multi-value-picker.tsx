// apps/web/src/components/pickers/multi-value-picker.tsx
'use client'

import {
  type FieldOptions,
  formatToDisplayValue,
  MAX_MULTI_VALUES,
} from '@auxx/lib/field-values/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandDetailItem,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import PhoneInputWithFlag from '@auxx/ui/components/phone-input'
import { cn } from '@auxx/ui/lib/utils'
import { formatPhoneNumber, formatUrlForDisplay, normalizeUrl } from '@auxx/utils'
import { type CountryCode, isSupportedCountry } from 'libphonenumber-js'
import { ArrowUpToLine, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Props for the MultiValuePicker component
 */
export interface MultiValuePickerProps {
  /** Field type driving validation + display formatting: EMAIL, URL or PHONE_INTL */
  fieldType: string

  /** Current value list — primary first (index 0) */
  values: string[]

  /** Called with the full re-ordered/edited array on every change */
  onChange: (values: string[]) => void

  /** Field options (phoneFormat, …) for display formatting */
  fieldOptions?: FieldOptions

  /** Placeholder text for the entry input */
  placeholder?: string

  /** Disabled state */
  disabled?: boolean

  /** Callback when arrow key capture state changes (for parent navigation) */
  onCaptureChange?: (capturing: boolean) => void

  /** Additional className for Command wrapper */
  className?: string

  /**
   * PHONE_INTL only — country assumed for a number typed without a `+` prefix,
   * and the flag the picker opens on. Callers pass the org's business country;
   * anything unrecognised falls back to `US`.
   */
  defaultCountry?: string
}

/** Narrow a loose country string to a libphonenumber `CountryCode`, defaulting to `US`. */
function toCountryCode(country: string | undefined): CountryCode {
  if (!country) return 'US'
  const code = country.trim().toUpperCase()
  return isSupportedCountry(code) ? (code as CountryCode) : 'US'
}

/** Client-side per-type validation gate for the Create row. Server still normalizes. */
export function isValidMultiValue(
  fieldType: string,
  raw: string,
  defaultCountry?: string
): boolean {
  const value = raw.trim()
  if (!value) return false
  switch (fieldType) {
    case 'EMAIL':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    case 'URL': {
      try {
        const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`
        const parsed = new URL(candidate)
        return parsed.hostname.includes('.')
      } catch {
        return false
      }
    }
    case 'PHONE_INTL':
      // `formatPhoneNumber` IS the decision — the same libphonenumber `isValid()`
      // the write path runs (`fieldValueSchemas.phone`). Never a looser regex
      // beside it, or the picker accepts values the server then 400s on.
      return formatPhoneNumber(value, toCountryCode(defaultCountry)) !== null
    default:
      return true
  }
}

/** Display-format one value for its row title (raw value stays the stored one). */
export function formatValueForDisplay(
  fieldType: string,
  value: string,
  fieldOptions?: FieldOptions
): string {
  if (!value) return value
  if (fieldType === 'PHONE_INTL') {
    return (
      (formatToDisplayValue({ type: 'text', value }, 'PHONE_INTL', fieldOptions) as string) || value
    )
  }
  if (fieldType === 'URL') {
    const normalized = normalizeUrl(value)
    return normalized ? formatUrlForDisplay(normalized) : value
  }
  return value
}

/**
 * Normalize a typed value before storing — email lowercases (matches the server
 * hooks), phone goes to E.164 through the shared normalizer.
 */
function normalizeNewValue(fieldType: string, raw: string, defaultCountry?: string): string {
  const value = raw.trim()
  if (fieldType === 'EMAIL') return value.toLowerCase()
  if (fieldType === 'PHONE_INTL') {
    return formatPhoneNumber(value, toCountryCode(defaultCountry)) ?? value
  }
  return value
}

/**
 * Duplicate-detection key. Phone normalizes first, so `(510) 111-3333` collides
 * with a stored `+15101113333` instead of being appended as a second value.
 */
function compareKey(fieldType: string, value: string, defaultCountry?: string): string {
  if (fieldType === 'PHONE_INTL') {
    return formatPhoneNumber(value, toCountryCode(defaultCountry)) ?? value.trim()
  }
  return value.trim().toLowerCase()
}

/** Default entry placeholder per type. */
function defaultPlaceholder(fieldType: string): string {
  return fieldType === 'PHONE_INTL' ? 'Enter phone number' : 'Search or add...'
}

/**
 * MultiValuePicker
 * Tags-style value-list editor for multi-value scalar fields (options.multi
 * EMAIL/URL/PHONE). Value rows are `CommandDetailItem`s with `selectionMode='none'`
 * — a bare row click is deliberately a no-op (it must never silently retarget
 * outbound mail); explicit hover actions handle set-as-primary and remove.
 *
 * The entry control is type-shaped. EMAIL/URL use a `CommandInput` that doubles
 * as filter and entry. PHONE_INTL instead gets `PhoneInputWithFlag` (country
 * dropdown, E.164 as you type) — filtering is dead weight under a 10-value cap,
 * and a phone number needs a country to be parseable at all.
 */
export function MultiValuePicker({
  fieldType,
  values,
  onChange,
  fieldOptions,
  placeholder,
  disabled = false,
  onCaptureChange,
  className,
  defaultCountry,
}: MultiValuePickerProps) {
  const isPhone = fieldType === 'PHONE_INTL'

  // Notify parent about capture state on mount/unmount
  useEffect(() => {
    onCaptureChange?.(true)
    return () => onCaptureChange?.(false)
  }, [onCaptureChange])

  const [searchValue, setSearchValue] = useState('')

  // Filter values by search (raw + display-formatted, case-insensitive).
  // The phone arm has NO search box — `searchValue` there is pending entry text,
  // so filtering by it would hide the existing numbers as a new one is typed.
  const filteredValues = useMemo(() => {
    if (isPhone || !searchValue.trim()) return values
    const search = searchValue.toLowerCase()
    return values.filter(
      (v) =>
        v.toLowerCase().includes(search) ||
        formatValueForDisplay(fieldType, v, fieldOptions).toLowerCase().includes(search)
    )
  }, [values, searchValue, fieldType, fieldOptions, isPhone])

  // Hide the Create row when the typed value already exists (normalized compare)
  const searchMatchesExisting = useMemo(() => {
    const typed = compareKey(fieldType, searchValue, defaultCountry)
    if (!typed) return true
    return values.some((v) => compareKey(fieldType, v, defaultCountry) === typed)
  }, [values, searchValue, fieldType, defaultCountry])

  const typedIsValid = useMemo(
    () => isValidMultiValue(fieldType, searchValue, defaultCountry),
    [fieldType, searchValue, defaultCountry]
  )

  const atCap = values.length >= MAX_MULTI_VALUES
  const showCreate =
    !disabled && searchValue.trim() !== '' && typedIsValid && !searchMatchesExisting && !atCap

  /** Append the typed value at the end of the list. */
  const createValue = useCallback(() => {
    const newValue = normalizeNewValue(fieldType, searchValue, defaultCountry)
    if (!newValue || !isValidMultiValue(fieldType, newValue, defaultCountry)) return
    const key = compareKey(fieldType, newValue, defaultCountry)
    if (values.some((v) => compareKey(fieldType, v, defaultCountry) === key)) {
      setSearchValue('')
      return
    }
    if (values.length >= MAX_MULTI_VALUES) return
    onChange([...values, newValue])
    setSearchValue('')
  }, [fieldType, searchValue, values, onChange, defaultCountry])

  /** Enter in the phone input commits — must not bubble into a form or the popover. */
  const handlePhoneKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      e.stopPropagation()
      createValue()
    },
    [createValue]
  )

  /** Label on the Add row — phone shows the normalized number, formatted. */
  const createLabel = useMemo(() => {
    if (!isPhone) return searchValue.trim()
    return formatValueForDisplay(
      fieldType,
      normalizeNewValue(fieldType, searchValue, defaultCountry),
      fieldOptions
    )
  }, [isPhone, fieldType, searchValue, defaultCountry, fieldOptions])

  /** Move a value to the front — index 0 IS the primary. */
  const setPrimary = useCallback(
    (value: string) => {
      const index = values.indexOf(value)
      if (index <= 0) return
      onChange([value, ...values.filter((_, i) => i !== index)])
    },
    [values, onChange]
  )

  /** Remove a value from the list. */
  const removeValue = useCallback(
    (value: string) => {
      onChange(values.filter((v) => v !== value))
    },
    [values, onChange]
  )

  // Land the caret in the NUMBER field on open, the way a bare `CommandInput`
  // does. `autoFocus` alone loses this race: the popover's focus scope focuses
  // the first TABBABLE element when it opens, and inside the phone input that
  // is the country-select button (react-phone-number-input renders it ahead of
  // the number field). Claim focus back on the next frame, once the scope has
  // settled — earlier than that and the scope simply overwrites it.
  const phoneRowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isPhone || disabled) return
    const frame = requestAnimationFrame(() => {
      phoneRowRef.current?.querySelector<HTMLInputElement>('input[data-slot=phone-input]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [isPhone, disabled])

  return (
    <Command shouldFilter={false} className={cn('rounded-lg', className)}>
      {isPhone ? (
        // `cmdk-input-wrapper` is load-bearing, not decoration: `Command` rounds
        // the list's top corners via `:not(:has([cmdk-input-wrapper]))`, which
        // would fire under this square-cornered row without it.
        <div
          ref={phoneRowRef}
          cmdk-input-wrapper=''
          className='flex shrink-0 items-center border-b border-border/50 dark:border-[#323842]/80 ps-1 pe-2'>
          <PhoneInputWithFlag
            value={searchValue}
            onChange={setSearchValue}
            onKeyDown={handlePhoneKeyDown}
            defaultCountry={defaultCountry}
            disabled={disabled}
            placeholder={placeholder ?? defaultPlaceholder(fieldType)}
            autoFocus
            className='h-8 flex-1 border-none shadow-none! [&>input]:h-8 [&>input]:flex-1 [&>input]:outline-none [&>input]:focus:ring-0 [&_[data-slot=country-select]]:bg-transparent [&_[data-slot=phone-input]]:w-full'
          />
        </div>
      ) : (
        <CommandInput
          placeholder={placeholder ?? defaultPlaceholder(fieldType)}
          value={searchValue}
          onValueChange={setSearchValue}
          disabled={disabled}
        />
      )}

      <CommandList>
        {/* Create row — inside the list, beside the results it filters. Hidden
            at the value cap and for invalid/duplicate input. */}
        {showCreate && (
          <>
            <CommandGroup>
              <CommandItem
                onSelect={createValue}
                className='cursor-pointer h-7'
                disabled={disabled}>
                <Plus className='text-muted-foreground' />
                <span>
                  Add "<span className='font-medium'>{createLabel}</span>"
                </span>
              </CommandItem>
            </CommandGroup>
            <div className='-mx-1 h-px bg-border/50' />
          </>
        )}

        {filteredValues.length === 0 && !searchValue.trim() && (
          <CommandEmpty>No values yet. Type to add one.</CommandEmpty>
        )}

        {filteredValues.length > 0 && (
          <CommandGroup>
            {filteredValues.map((value) => {
              const index = values.indexOf(value)
              const isPrimary = index === 0
              return (
                <CommandDetailItem
                  key={value}
                  value={value}
                  title={formatValueForDisplay(fieldType, value, fieldOptions)}
                  secondary={
                    isPrimary ? (
                      <Badge variant='secondary' className='shrink-0'>
                        Primary
                      </Badge>
                    ) : undefined
                  }
                  selectionMode='none'
                  // A bare click must never retarget outbound mail — actions
                  // are explicit hover buttons only.
                  onSelect={() => {}}
                  disabled={disabled}
                  actions={
                    <>
                      {!isPrimary && (
                        <Button
                          variant='ghost'
                          size='icon-xs'
                          title='Set as primary'
                          disabled={disabled}
                          onClick={(e) => {
                            e.stopPropagation()
                            setPrimary(value)
                          }}>
                          <ArrowUpToLine />
                        </Button>
                      )}
                      <Button
                        variant='destructive-hover'
                        size='icon-xs'
                        title='Remove'
                        disabled={disabled}
                        onClick={(e) => {
                          e.stopPropagation()
                          removeValue(value)
                        }}>
                        <Trash2 />
                      </Button>
                    </>
                  }
                />
              )
            })}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
