// apps/web/src/components/workflow/nodes/shared/node-inputs/currency-input.tsx

import { readCurrency } from '@auxx/lib/field-values/client'
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
  /** Fraction digits to render. Omit to derive from the currency code. */
  decimals?: number
  /** How to display currency (symbol, code, name, or compact) */
  currencyDisplay?: 'symbol' | 'code' | 'name' | 'compact'
  /** Whether to use grouping separators */
  useGrouping?: boolean
}

/**
 * Currency input component for workflow nodes.
 *
 * Stores the value as INTEGER MINOR UNITS (cents for USD, whole yen for JPY),
 * displayed as a major-unit decimal. The denomination comes from the node's
 * config; a value never carries its own code.
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
    decimals,
    currencyDisplay = 'symbol',
  }) => {
    // Track if we should trigger onChange after blur parsing
    const shouldUpdateRef = useRef(false)

    // Node inputs arrive as numbers, numeric strings, or a connector's
    // `{ amount }`. `readCurrency` narrows all three to minor units, or null —
    // never `NaN`, which would blank the input with no error.
    const value = readCurrency(inputs[name])

    /**
     * Handle value change from CurrencyInput (value is in cents)
     */
    const handleValueChange = useCallback(
      (next: number | undefined) => {
        onError(name, null)

        // Only update on blur (when shouldUpdateRef is true)
        if (shouldUpdateRef.current) {
          shouldUpdateRef.current = false
          onChange(name, next ?? null)
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
        currencyDisplay={currencyDisplay === 'compact' ? 'symbol' : currencyDisplay}
        decimals={decimals}
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
