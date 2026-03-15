// packages/ui/src/components/input-currency.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import * as React from 'react'
import { clampValue, decrementValue, incrementValue } from './input-number-utils'

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Currency display options
 */
export type CurrencyDisplayType = 'symbol' | 'code' | 'name'

/**
 * Decimal places type for currency display
 */
export type DecimalPlacesType = 'two-places' | 'no-decimal'

/**
 * Context value provided by CurrencyInput to all child components
 */
interface CurrencyInputContextValue {
  /** Current value in cents (integer) */
  value: number | undefined
  /** Whether the input is disabled */
  disabled?: boolean
  /** Whether the input is read-only */
  readOnly?: boolean
  /** Minimum allowed value in cents */
  min?: number
  /** Maximum allowed value in cents */
  max?: number
  /** ISO 4217 currency code */
  currencyCode: string
  /** How to display the currency */
  currencyDisplay: CurrencyDisplayType
  /** Decimal places for display */
  decimalPlaces: DecimalPlacesType
  /** Locale for formatting */
  locale: string
  /** Increment the value (by 100 cents = $1 by default) */
  increment: () => void
  /** Decrement the value (by 100 cents = $1 by default) */
  decrement: () => void
  /** Set a new value (in cents) with validation and clamping */
  setValue: (value: number | undefined) => void
  /** Get the currency symbol */
  getCurrencySymbol: () => string
  /** Format cents to display string */
  formatValue: (cents: number) => string
  /** Parse display string to cents */
  parseValue: (display: string) => number | null
}

/**
 * Props for the CurrencyInput root component (context provider)
 */
export interface CurrencyInputProps extends React.PropsWithChildren {
  /** Controlled value in cents */
  value?: number
  /** Default value for uncontrolled mode (in cents) */
  defaultValue?: number
  /** Callback when value changes (value is in cents) */
  onValueChange?: (value: number | undefined) => void
  /** Minimum allowed value in cents */
  min?: number
  /** Maximum allowed value in cents */
  max?: number
  /** ISO 4217 currency code (default: 'USD') */
  currencyCode?: string
  /** How to display the currency (default: 'symbol') */
  currencyDisplay?: CurrencyDisplayType
  /** Decimal places (default: 'two-places') */
  decimalPlaces?: DecimalPlacesType
  /** Locale for formatting (default: 'en-US') */
  locale?: string
  /** Whether the input is disabled */
  disabled?: boolean
  /** Whether the input is read-only */
  readOnly?: boolean
}

/**
 * Props for the CurrencyInputField component
 */
export interface CurrencyInputFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  /** Show currency symbol as prefix (default: true) */
  showSymbol?: boolean
}

// ============================================================================
// Context
// ============================================================================

const CurrencyInputContext = React.createContext<CurrencyInputContextValue | undefined>(undefined)

/**
 * Hook to access CurrencyInput context
 * @throws Error if used outside CurrencyInput provider
 */
function useCurrencyInput() {
  const context = React.useContext(CurrencyInputContext)
  if (!context) {
    throw new Error('CurrencyInput components must be used within a CurrencyInput provider')
  }
  return context
}

// ============================================================================
// CurrencyInput (Root Component)
// ============================================================================

/**
 * CurrencyInput root component that provides context for currency input behavior.
 * Values are stored as cents (integers) to avoid floating-point precision issues.
 *
 * @example
 * ```tsx
 * <CurrencyInput value={priceInCents} onValueChange={setPriceInCents} currencyCode="USD">
 *   <InputGroup>
 *     <CurrencyInputField placeholder="0.00" />
 *   </InputGroup>
 * </CurrencyInput>
 * ```
 */
function CurrencyInput({
  value: controlledValue,
  defaultValue,
  onValueChange,
  min,
  max,
  currencyCode = 'USD',
  currencyDisplay = 'symbol',
  decimalPlaces = 'two-places',
  locale = 'en-US',
  disabled = false,
  readOnly = false,
  children,
}: CurrencyInputProps) {
  // Determine if component is controlled
  const isControlled = controlledValue !== undefined

  // Internal state for uncontrolled mode
  const [uncontrolledValue, setUncontrolledValue] = React.useState<number | undefined>(defaultValue)

  // Use controlled value if provided, otherwise use internal state
  const value = isControlled ? controlledValue : uncontrolledValue

  // Step is 100 cents ($1.00)
  const step = 100

  /**
   * Get currency symbol using Intl
   */
  const getCurrencySymbol = React.useCallback((): string => {
    try {
      const formatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyCode,
        currencyDisplay: 'symbol',
      })
      const parts = formatter.formatToParts(0)
      const symbolPart = parts.find((p) => p.type === 'currency')
      return symbolPart?.value || currencyCode
    } catch {
      return currencyCode
    }
  }, [locale, currencyCode])

  /**
   * Format cents to display string (without currency symbol)
   */
  const formatValue = React.useCallback(
    (cents: number): string => {
      const dollars = cents / 100
      if (decimalPlaces === 'no-decimal') {
        return Math.round(dollars).toString()
      }
      return dollars.toFixed(2)
    },
    [decimalPlaces]
  )

  /**
   * Parse display string to cents
   */
  const parseValue = React.useCallback((display: string): number | null => {
    // Remove currency symbols, commas, spaces
    const cleaned = display.replace(/[$€£¥₹₩,\s]/g, '').trim()
    if (!cleaned) return null

    const parsed = parseFloat(cleaned)
    if (Number.isNaN(parsed)) return null

    // Convert to cents
    return Math.round(parsed * 100)
  }, [])

  /**
   * Set value with validation and clamping
   */
  const setValue = React.useCallback(
    (newValue: number | undefined) => {
      const clampedValue = clampValue(newValue, min, max)

      if (!isControlled) {
        setUncontrolledValue(clampedValue)
      }

      onValueChange?.(clampedValue)
    },
    [isControlled, min, max, onValueChange]
  )

  /**
   * Increment value by step amount (100 cents)
   */
  const increment = React.useCallback(() => {
    if (disabled || readOnly) return
    const newValue = incrementValue(value, step, max)
    setValue(newValue)
  }, [disabled, readOnly, value, max, setValue])

  /**
   * Decrement value by step amount (100 cents)
   */
  const decrement = React.useCallback(() => {
    if (disabled || readOnly) return
    const newValue = decrementValue(value, step, min)
    setValue(newValue)
  }, [disabled, readOnly, value, min, setValue])

  const contextValue: CurrencyInputContextValue = React.useMemo(
    () => ({
      value,
      disabled,
      readOnly,
      min,
      max,
      currencyCode,
      currencyDisplay,
      decimalPlaces,
      locale,
      increment,
      decrement,
      setValue,
      getCurrencySymbol,
      formatValue,
      parseValue,
    }),
    [
      value,
      disabled,
      readOnly,
      min,
      max,
      currencyCode,
      currencyDisplay,
      decimalPlaces,
      locale,
      increment,
      decrement,
      setValue,
      getCurrencySymbol,
      formatValue,
      parseValue,
    ]
  )

  return (
    <CurrencyInputContext.Provider value={contextValue}>{children}</CurrencyInputContext.Provider>
  )
}

// ============================================================================
// CurrencyInputField
// ============================================================================

/**
 * CurrencyInputField component - the actual input element for currency input.
 * Displays value in dollars but stores in cents.
 * Use this INSIDE InputGroup components.
 *
 * @example
 * ```tsx
 * <CurrencyInput value={priceInCents} onValueChange={setPriceInCents}>
 *   <InputGroup>
 *     <CurrencyInputField placeholder="0.00" />
 *   </InputGroup>
 * </CurrencyInput>
 * ```
 */
const CurrencyInputField = React.forwardRef<HTMLInputElement, CurrencyInputFieldProps>(
  ({ className, showSymbol = true, onKeyDown, onBlur, ...props }, ref) => {
    const {
      value,
      disabled,
      readOnly,
      min,
      max,
      decimalPlaces,
      increment,
      decrement,
      setValue,
      getCurrencySymbol,
      formatValue,
      parseValue,
    } = useCurrencyInput()

    // Local state for what user is typing
    const [displayValue, setDisplayValue] = React.useState<string>('')

    // Step for keyboard navigation (100 cents)
    const step = 100

    // Get currency symbol
    const symbol = getCurrencySymbol()

    // Sync display value with context value when it changes externally
    React.useEffect(() => {
      setDisplayValue(value !== undefined ? formatValue(value) : '')
    }, [value, formatValue])

    /**
     * Handle keyboard navigation
     */
    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        onKeyDown?.(e)

        if (disabled || readOnly) return

        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault()
            increment()
            break
          case 'ArrowDown':
            e.preventDefault()
            decrement()
            break
          case 'PageUp':
            e.preventDefault()
            setValue(incrementValue(value, step * 10, max))
            break
          case 'PageDown':
            e.preventDefault()
            setValue(decrementValue(value, step * 10, min))
            break
          case 'Home':
            if (min !== undefined) {
              e.preventDefault()
              setValue(min)
            }
            break
          case 'End':
            if (max !== undefined) {
              e.preventDefault()
              setValue(max)
            }
            break
        }
      },
      [disabled, readOnly, onKeyDown, increment, decrement, setValue, value, max, min]
    )

    /**
     * Handle blur - parse, clamp, and sync to context
     */
    const handleBlur = React.useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        onBlur?.(e)

        const inputValue = displayValue.trim()
        if (inputValue === '' || inputValue === '-') {
          setValue(undefined)
          setDisplayValue('')
          return
        }

        const cents = parseValue(inputValue)
        if (cents !== null) {
          const clampedValue = clampValue(cents, min, max)
          setValue(clampedValue)
          setDisplayValue(clampedValue !== undefined ? formatValue(clampedValue) : '')
        } else {
          // Invalid input - revert to context value
          setDisplayValue(value !== undefined ? formatValue(value) : '')
        }
      },
      [onBlur, displayValue, setValue, parseValue, min, max, value, formatValue]
    )

    /**
     * Handle input change - update display value only
     */
    const handleChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      setDisplayValue(e.target.value)
    }, [])

    return (
      <div className='relative flex flex-1 flex-row items-center'>
        {showSymbol && (
          <span className='text-muted-foreground shrink-0 pointer-events-none text-sm pe-1 ps-2'>
            {symbol}
          </span>
        )}
        <input
          ref={ref}
          type='text'
          inputMode='decimal'
          autoComplete='one-time-code'
          data-slot='input-group-control'
          role='spinbutton'
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          value={displayValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          disabled={disabled}
          readOnly={readOnly}
          step={decimalPlaces === 'no-decimal' ? '1' : '0.01'}
          className={cn(
            // Base styling
            'flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:outline-none focus:ring-0 focus:outline-none dark:bg-transparent',
            // Text sizing and alignment
            'text-sm',
            // Padding for symbol
            // showSymbol ? 'pl-5' : 'pl-3',
            'pr-3',
            className
          )}
          {...props}
        />
      </div>
    )
  }
)
CurrencyInputField.displayName = 'CurrencyInputField'

// ============================================================================
// Exports
// ============================================================================

export { CurrencyInput, CurrencyInputField, useCurrencyInput }
