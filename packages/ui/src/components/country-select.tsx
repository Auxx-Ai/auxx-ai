// packages/ui/src/components/country-select.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, Globe } from 'lucide-react'
import React, { forwardRef, useMemo } from 'react'
import * as RPNInput from 'react-phone-number-input'
import flags from 'react-phone-number-input/flags'
import { CountrySelect as BaseCountrySelect } from './phone-input'
import { selectTriggerVariants } from './select'

/** Props for the standalone CountrySelect component */
type StandaloneCountrySelectProps = {
  /** ISO 3166-1 alpha-2 country code (e.g. 'US') */
  value: string
  /** Callback with the selected country code */
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  placeholder?: string
  /** Trigger styling — `'transparent'` matches an inline field-panel input. */
  variant?: 'default' | 'transparent' | 'translucent'
  /** Trigger height — `'sm'` matches `Input size='sm'` rows (address sub-fields). */
  size?: 'default' | 'sm'
}

/** Flag icon with Globe fallback instead of PhoneIcon */
function CountryFlag({ code, name }: { code: RPNInput.Country; name: string }) {
  const Flag = flags[code]
  return (
    <span className='w-5 overflow-hidden rounded-sm'>
      {Flag ? <Flag title={name} /> : <Globe className='size-4 text-muted-foreground' />}
    </span>
  )
}

/**
 * Standalone country select for forms (billing address, etc.)
 * Wraps the phone-input CountrySelect with a form-friendly trigger
 */
const CountrySelect = forwardRef<HTMLButtonElement, StandaloneCountrySelectProps>(
  (
    {
      value,
      onChange,
      disabled,
      className,
      placeholder = 'Select country',
      variant = 'default',
      size = 'default',
    },
    ref
  ) => {
    /** Build full country options from react-phone-number-input */
    const options = useMemo(() => {
      // One DisplayNames instance for ~250 lookups — constructing it per country is the
      // expensive part of this list.
      const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
      return RPNInput.getCountries()
        .map((code) => ({ value: code, label: regionNames.of(code) || code }))
        .sort((a, b) => a.label.localeCompare(b.label))
    }, [])

    const selectedLabel = options.find((o) => o.value === value)?.label

    return (
      <BaseCountrySelect
        value={value as RPNInput.Country}
        onChange={(code) => onChange(code as string)}
        options={options}
        disabled={disabled}
        showCallingCodes={false}
        trigger={({ value: _v }) => (
          <button
            ref={ref}
            type='button'
            disabled={disabled}
            aria-label='Select country'
            className={cn(
              selectTriggerVariants({ variant, size }),
              'gap-2 font-normal',
              !value && (variant === 'translucent' ? 'text-white/60' : 'text-primary-400'),
              className
            )}>
            {value && selectedLabel ? (
              <>
                <CountryFlag code={value as RPNInput.Country} name={selectedLabel} />
                <span className='flex-1 truncate text-left'>{selectedLabel}</span>
              </>
            ) : (
              <span
                className={cn(
                  'flex-1 truncate text-left',
                  variant === 'translucent' ? 'text-white/60' : 'text-primary-400'
                )}>
                {placeholder}
              </span>
            )}
            <ChevronDown className='size-4 opacity-50' />
          </button>
        )}
      />
    )
  }
)

CountrySelect.displayName = 'CountrySelect'

export { CountrySelect }
export type { StandaloneCountrySelectProps as CountrySelectProps }
