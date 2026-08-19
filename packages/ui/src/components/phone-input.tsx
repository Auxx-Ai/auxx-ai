'use client'

import { cn } from '@auxx/ui/lib/utils'
import { PhoneIcon } from 'lucide-react'
// packages/ui/src/components/phone-input.tsx
import React, { createContext, useContext, useId, useMemo, useRef, useState } from 'react'
import * as RPNInput from 'react-phone-number-input'
import flags from 'react-phone-number-input/flags'
import {
  Command,
  CommandDetailItem,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
  CommandSeparator,
} from './command'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

/** Context to pass props directly to PhoneInput, bypassing react-phone-number-input */
const PhoneInputContext = createContext<{
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  autoFocus?: boolean
}>({})

export interface PhoneInputWithFlagProps {
  value: string
  onChange?: (value: string) => void // For direct compatibility with react-hook-form
  setValue?: (value: string) => void // Keeping original API for backward compatibility
  onBlur?: () => void // Required for react-hook-form validation
  disabled?: boolean
  name?: string
  placeholder?: string
  className?: string
  countryClassName?: string
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  autoFocus?: boolean
  /**
   * Country assumed for a number typed without a `+` prefix, and the flag the
   * picker starts on. Accepts a loose `string` so callers can pass an org
   * setting straight through — anything `react-phone-number-input` doesn't
   * recognise falls back to `US` rather than throwing.
   */
  defaultCountry?: string
}

/** Narrow a loose country string to an RPN `Country`, falling back to `US`. */
function toCountry(country: string | undefined): RPNInput.Country {
  if (!country) return 'US'
  const code = country.trim().toUpperCase()
  return RPNInput.isSupportedCountry(code) ? (code as RPNInput.Country) : 'US'
}

function PhoneInputWithFlag({
  value,
  onChange,
  setValue,
  onBlur,
  disabled,
  name,
  placeholder = 'Enter phone number',
  className,
  countryClassName,
  onKeyDown,
  autoFocus,
  defaultCountry,
  ...props
}: PhoneInputWithFlagProps) {
  const id = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const country = toCountry(defaultCountry)

  /** Support both setValue (original) and onChange (react-hook-form style) */
  const handleChange = (newValue: string | undefined) => {
    if (onChange) onChange(newValue ?? '')
    if (setValue) setValue(newValue ?? '')
  }

  return (
    <PhoneInputContext.Provider value={{ onKeyDown, autoFocus }}>
      <div ref={containerRef}>
        <RPNInput.default
          className={cn('flex rounded-xl shadow-2xs', className)}
          international
          flagComponent={FlagComponent}
          defaultCountry={country}
          countrySelectComponent={CountrySelect}
          countrySelectProps={{
            className: countryClassName || '',
            containerRef,
            favoriteCountry: country,
          }}
          inputComponent={PhoneInput}
          numberInputProps={{ autoFocus }}
          id={id}
          name={name}
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          onBlur={onBlur}
          disabled={disabled}
          {...props}
        />
      </div>
    </PhoneInputContext.Provider>
  )
}

PhoneInputWithFlag.displayName = 'PhoneInputWithFlag'

function PhoneInput({ className, autoFocus, ...props }: React.ComponentProps<'input'>) {
  const { onKeyDown, autoFocus: contextAutoFocus } = useContext(PhoneInputContext)
  const shouldAutoFocus = contextAutoFocus || autoFocus

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e)
  }

  // Move cursor to end on focus
  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const input = e.target
    const len = input.value.length
    input.setSelectionRange(len, len)
  }

  return (
    <input
      data-slot='phone-input'
      {...props}
      autoFocus={shouldAutoFocus}
      className={cn('-ms-px text-sm rounded-s-none shadow-none focus-visible:z-10', className)}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
    />
  )
}

PhoneInput.displayName = 'PhoneInput'

/**
 * One country row in the picker: flag, name, optional dial code, blue selected check.
 * The dial code sits in `secondary` (inline, right after the name) rather than `trailing`,
 * so the row's right edge belongs to the selection check alone.
 */
function CountryRow({
  option,
  selected,
  showCallingCode,
  onSelect,
}: {
  option: { value: RPNInput.Country; label: string; callingCode: string }
  selected: boolean
  showCallingCode: boolean
  onSelect: (code: RPNInput.Country) => void
}) {
  return (
    <CommandDetailItem
      // Label first so typing a country name filters — cmdk indexes this string, and the
      // ISO code alone (e.g. `US`) would make "United" match nothing.
      value={`${option.label} ${option.callingCode}`}
      title={option.label}
      icon={<FlagComponent country={option.value} countryName={option.label} />}
      secondary={
        showCallingCode ? (
          <span className='text-muted-foreground text-xs'>{option.callingCode}</span>
        ) : undefined
      }
      selected={selected}
      selectionMode='check'
      onSelect={() => onSelect(option.value)}
    />
  )
}

/** Props for the CountrySelect component */
type CountrySelectProps = {
  disabled?: boolean
  value: RPNInput.Country
  onChange: (value: RPNInput.Country) => void
  options: { label: string; value: RPNInput.Country | undefined }[]
  className?: string
  /** Ref to the container element for measuring popover width */
  containerRef?: React.RefObject<HTMLDivElement | null>
  /** Custom trigger element. Receives current value and selected country label. */
  trigger?: (props: { value: RPNInput.Country; label: string | undefined }) => React.ReactNode
  /** Whether to show calling codes in the dropdown list */
  showCallingCodes?: boolean
  /**
   * Country pinned above the full list under "Favorites". Defaults to `US`;
   * `PhoneInputWithFlag` passes the org's own country so a non-US org gets its
   * own dial code one click away instead of the US one.
   */
  favoriteCountry?: RPNInput.Country
}

/** Searchable country select using a combobox */
const CountrySelect = ({
  disabled,
  value,
  onChange,
  options,
  className,
  containerRef,
  trigger,
  showCallingCodes = true,
  favoriteCountry = 'US',
}: CountrySelectProps) => {
  const [open, setOpen] = useState(false)
  const [popoverWidth, setPopoverWidth] = useState<number | undefined>(undefined)

  /** Measure container width when popover opens */
  React.useEffect(() => {
    if (open && containerRef?.current) {
      setPopoverWidth(containerRef.current.offsetWidth)
    }
  }, [open, containerRef])

  /** Filter out empty values and add calling codes to labels */
  const countryOptions = useMemo(
    () =>
      options
        .filter((x): x is { label: string; value: RPNInput.Country } => !!x.value)
        .map((option) => ({
          value: option.value,
          label: option.label,
          callingCode: `+${RPNInput.getCountryCallingCode(option.value)}`,
        })),
    [options]
  )

  /** Handle country selection */
  const handleSelect = (countryCode: string) => {
    onChange(countryCode as RPNInput.Country)
    setOpen(false)
  }

  return (
    <Popover open={disabled ? false : open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        {trigger ? (
          trigger({
            value,
            label: countryOptions.find((o) => o.value === value)?.label,
          })
        ) : (
          <button
            type='button'
            data-slot='country-select'
            disabled={disabled}
            aria-label='Select country'
            className={cn(
              'border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground relative inline-flex items-center self-stretch rounded-s-xl py-2 ps-0.5 pe-2 transition-[color,box-shadow] outline-hidden disabled:pointer-events-none disabled:opacity-50',
              className
            )}>
            <div className='inline-flex items-center gap-1'>
              <FlagComponent country={value} countryName={value} />
            </div>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='p-0'
        style={popoverWidth ? { width: popoverWidth } : undefined}>
        <Command>
          <CommandInput placeholder='Search country...' />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            {/* Selected country at top */}
            {value && (
              <>
                <CommandGroup>
                  {countryOptions
                    .filter((option) => option.value === value)
                    .map((option) => (
                      <CountryRow
                        key={option.value}
                        option={option}
                        selected
                        showCallingCode={showCallingCodes}
                        onSelect={handleSelect}
                      />
                    ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            {/* Favorites - show the org's country if it isn't already selected */}
            {value !== favoriteCountry && (
              <>
                <CommandGroup heading='Favorites'>
                  {countryOptions
                    .filter((option) => option.value === favoriteCountry)
                    .map((option) => (
                      <CountryRow
                        key={option.value}
                        option={option}
                        selected={false}
                        showCallingCode={showCallingCodes}
                        onSelect={handleSelect}
                      />
                    ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            {/* All other countries */}
            <CommandGroup heading='Countries'>
              {countryOptions
                .filter((option) => option.value !== value && option.value !== favoriteCountry)
                .map((option) => (
                  <CountryRow
                    key={option.value}
                    option={option}
                    selected={false}
                    showCallingCode={showCallingCodes}
                    onSelect={handleSelect}
                  />
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

const FlagComponent = ({ country, countryName }: RPNInput.FlagProps) => {
  const Flag = flags[country]

  return (
    <span className='w-5 overflow-hidden rounded-sm'>
      {Flag ? <Flag title={countryName} /> : <PhoneIcon size={16} aria-hidden='true' />}
    </span>
  )
}

export { CountrySelect }
export type { CountrySelectProps }
export default PhoneInputWithFlag
