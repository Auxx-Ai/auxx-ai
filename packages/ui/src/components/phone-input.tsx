'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Check, PhoneIcon } from 'lucide-react'
// packages/ui/src/components/phone-input.tsx
import React, { createContext, useContext, useId, useMemo, useRef, useState } from 'react'
import * as RPNInput from 'react-phone-number-input'
import flags from 'react-phone-number-input/flags'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
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
  ...props
}: PhoneInputWithFlagProps) {
  const id = useId()
  const containerRef = useRef<HTMLDivElement>(null)

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
          defaultCountry='US'
          countrySelectComponent={CountrySelect}
          countrySelectProps={{
            className: countryClassName || '',
            containerRef,
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

/** Props for the CountrySelect component */
type CountrySelectProps = {
  disabled?: boolean
  value: RPNInput.Country
  onChange: (value: RPNInput.Country) => void
  options: { label: string; value: RPNInput.Country | undefined }[]
  className?: string
  /** Ref to the container element for measuring popover width */
  containerRef?: React.RefObject<HTMLDivElement | null>
}

/** Searchable country select using a combobox */
const CountrySelect = ({
  disabled,
  value,
  onChange,
  options,
  className,
  containerRef,
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
            {/* <ChevronDownIcon className="size-3 text-muted-foreground/80" aria-hidden="true" /> */}
          </div>
        </button>
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
                      <CommandItem
                        key={option.value}
                        value={`${option.label} ${option.callingCode}`}
                        onSelect={() => handleSelect(option.value)}>
                        <FlagComponent country={option.value} countryName={option.label} />
                        <span className='flex-1 truncate'>{option.label}</span>
                        <span className='text-muted-foreground text-xs'>{option.callingCode}</span>
                        <Check className='ml-auto size-4' />
                      </CommandItem>
                    ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            {/* Favorites - show US if not selected */}
            {value !== 'US' && (
              <>
                <CommandGroup heading='Favorites'>
                  {countryOptions
                    .filter((option) => option.value === 'US')
                    .map((option) => (
                      <CommandItem
                        key={option.value}
                        value={`${option.label} ${option.callingCode}`}
                        onSelect={() => handleSelect(option.value)}>
                        <FlagComponent country={option.value} countryName={option.label} />
                        <span className='flex-1 truncate'>{option.label}</span>
                        <span className='text-muted-foreground text-xs'>{option.callingCode}</span>
                      </CommandItem>
                    ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            {/* All other countries */}
            <CommandGroup heading='Countries'>
              {countryOptions
                .filter((option) => option.value !== value && option.value !== 'US')
                .map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.callingCode}`}
                    onSelect={() => handleSelect(option.value)}>
                    <FlagComponent country={option.value} countryName={option.label} />
                    <span className='flex-1 truncate'>{option.label}</span>
                    <span className='text-muted-foreground text-xs'>{option.callingCode}</span>
                  </CommandItem>
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

export default PhoneInputWithFlag
