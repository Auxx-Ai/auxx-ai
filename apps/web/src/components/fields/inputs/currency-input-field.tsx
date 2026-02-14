// apps/web/src/components/fields/inputs/currency-input-field.tsx
'use client'

import {
  CurrencyInputField as BaseCurrencyInputField,
  CurrencyInput,
} from '@auxx/ui/components/input-currency'
import { InputGroup } from '@auxx/ui/components/input-group'
import { NumberInputArrows } from '@auxx/ui/components/input-number'
import { cn } from '@auxx/ui/lib/utils'
import type { CurrencyDisplayOptions } from '@auxx/utils'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFieldNavigationOptional } from '../field-navigation-context'
import { usePropertyContext } from '../property-provider'

/**
 * CurrencyInputField
 * Wrapper for the @auxx/ui CurrencyInput that integrates with property context
 *
 * Keyboard behavior:
 * - ArrowUp/Down: Increment/decrement value (handled by BaseCurrencyInputField)
 * - Enter: Accept value and close popover
 * - Blur: Save value (fire-and-forget)
 *
 * Note: CAPTURES arrow keys for value changes, not row navigation.
 *
 * Note: The UI component's blur handler calls onBlur BEFORE parsing the value
 * and calling onValueChange. So we use a ref flag to trigger save in onValueChange
 * instead of in onBlur directly.
 */
export function CurrencyInputField() {
  const { value, trackChange, commitValue, close, isSaving, field } = usePropertyContext()
  const nav = useFieldNavigationOptional()

  // Capture keys while open (arrows used for increment/decrement)
  useEffect(() => {
    nav?.setPopoverCapturing(true)
    return () => nav?.setPopoverCapturing(false)
  }, [nav])

  // Track if we should save on the next value change (set true on blur)
  const shouldSaveRef = useRef(false)

  const options: CurrencyDisplayOptions = useMemo(() => {
    return (
      field.options?.currency || {
        currencyCode: 'USD',
        decimalPlaces: 'two-places',
        displayType: 'symbol',
        groups: 'default',
      }
    )
  }, [field.options])

  /**
   * Handle value change from CurrencyInput (value is in cents)
   * This is called AFTER the UI component parses the value on blur
   */
  const handleValueChange = useCallback(
    (cents: number | undefined) => {
      const newValue = cents ?? null
      trackChange(newValue)

      // If blur triggered this change, save now (fire-and-forget)
      if (shouldSaveRef.current) {
        shouldSaveRef.current = false
        commitValue(newValue)
      }
    },
    [trackChange, commitValue]
  )

  /**
   * Handle blur - mark that we should save on next value change
   * Note: This is called BEFORE onValueChange, so we can't save here directly
   */
  const handleBlur = useCallback(() => {
    shouldSaveRef.current = true
  }, [])

  /**
   * Handle Enter key - blur to trigger parse, then close
   * The blur triggers CurrencyInputField to parse and commit the value.
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        // Blur triggers: parse -> onValueChange -> save (via shouldSaveRef)
        e.currentTarget.blur()
        // Close the popover (value already saved by blur handler)
        close()
      }
    },
    [close]
  )

  return (
    <CurrencyInput
      value={value ?? undefined}
      onValueChange={handleValueChange}
      currencyCode={options.currencyCode}
      decimalPlaces={options.decimalPlaces}
      disabled={isSaving}>
      <InputGroup className={cn('h-[27px] ring-0! border-0', isSaving ? 'opacity-70' : '')}>
        {/* <InputGroup> */}
        <BaseCurrencyInputField
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder='0.00'
          autoFocus
          className='text-left pl-0!'
        />
      </InputGroup>
      {/* </InputGroup> */}
    </CurrencyInput>
  )
}
