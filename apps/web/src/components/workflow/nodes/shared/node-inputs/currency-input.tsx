// apps/web/src/components/workflow/nodes/shared/node-inputs/currency-input.tsx

import {
  CurrencyInputField,
  CurrencyInput as CurrencyInputUi,
} from '@auxx/ui/components/input-currency'
import { InputGroup } from '@auxx/ui/components/input-group'
import type React from 'react'
import { useCallback, useRef } from 'react'
import { createNodeInput, type NodeInputProps } from './base-node-input'

/**
 * Props for CurrencyInput node component
 */
interface CurrencyInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Placeholder text */
  placeholder?: string
  /** ISO 4217 currency code (default: 'USD') */
  currencyCode?: string
  /** Number of decimal places (0 or 2) */
  decimalPlaces?: number
  /** How to display currency (symbol, code, or name) */
  displayType?: 'symbol' | 'code' | 'name'
  /** Whether to use grouping separators */
  useGrouping?: boolean
}

/**
 * Currency input component for workflow nodes
 * Stores value as cents (integer), displays as decimal
 */
export const CurrencyInput = createNodeInput<CurrencyInputProps>(
  ({
    inputs,
    onChange,
    onError,
    isLoading,
    name,
    placeholder = '0.00',
    currencyCode = 'USD',
    decimalPlaces = 2,
  }) => {
    // Track if we should trigger onChange after blur parsing
    const shouldUpdateRef = useRef(false)

    // Get value from inputs - stored as cents
    const rawValue = inputs[name]
    const value =
      rawValue !== undefined && rawValue !== null && rawValue !== ''
        ? typeof rawValue === 'number'
          ? rawValue
          : parseInt(String(rawValue), 10)
        : undefined

    /**
     * Handle value change from CurrencyInput (value is in cents)
     */
    const handleValueChange = useCallback(
      (cents: number | undefined) => {
        onError(name, null)

        // Only update on blur (when shouldUpdateRef is true)
        if (shouldUpdateRef.current) {
          shouldUpdateRef.current = false
          onChange(name, cents ?? null)
        }
      },
      [name, onChange, onError]
    )

    /**
     * Handle blur - mark that we should update on next value change
     */
    const handleBlur = useCallback(() => {
      shouldUpdateRef.current = true
    }, [])

    /**
     * Handle Enter key - trigger blur to parse and save
     */
    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.currentTarget.blur()
      }
    }, [])

    return (
      <CurrencyInputUi
        value={value}
        onValueChange={handleValueChange}
        currencyCode={currencyCode}
        decimalPlaces={decimalPlaces === 0 ? 'no-decimal' : 'two-places'}
        disabled={isLoading}>
        <InputGroup className='bg-transparent dark:bg-transparent h-[28px] shadow-none ring-0 border-0 has-[[data-slot=input-group-control]:focus-visible]:ring-[0px]'>
          <CurrencyInputField
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className='text-start ps-0 placeholder:text-primary-400'
          />
        </InputGroup>
      </CurrencyInputUi>
    )
  }
)
