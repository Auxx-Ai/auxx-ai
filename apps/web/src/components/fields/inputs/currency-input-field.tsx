// apps/web/src/components/fields/inputs/currency-input-field.tsx
'use client'

import {
  type CurrencyFieldOptions,
  readCurrency,
  resolveCurrencyCode,
} from '@auxx/lib/field-values/client'
import {
  CurrencyInputField as BaseCurrencyInputField,
  CurrencyInput,
} from '@auxx/ui/components/input-currency'
import { InputGroup } from '@auxx/ui/components/input-group'
import { cn } from '@auxx/ui/lib/utils'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useOrgCurrency } from '~/hooks/use-org-currency'
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
 *
 * VALUE SHAPE. Read and write are both a BARE NUMBER of minor units — the
 * denomination is the field's (`options.currencyCode`), asserted once and
 * inherited by every value. Symmetry here is load-bearing: an asymmetric shape
 * makes `hasValueChanged` compare a number against an object, which reports a
 * change on every blur and commits a field nobody edited.
 */
export function CurrencyInputField() {
  const { value, trackChange, commitValue, close, isSaving, field } = usePropertyContext()
  const nav = useFieldNavigationOptional()
  const orgCurrency = useOrgCurrency()

  // Capture keys while open (arrows used for increment/decrement)
  useEffect(() => {
    nav?.setPopoverCapturing(true)
    return () => nav?.setPopoverCapturing(false)
  }, [nav])

  // Track if we should save on the next value change (set true on blur)
  const shouldSaveRef = useRef(false)

  const options = useMemo(() => {
    const opts = field.options as CurrencyFieldOptions | undefined
    return {
      currencyCode: resolveCurrencyCode(opts?.currencyCode, orgCurrency),
      // Undefined means "derive from the code" — right for JPY (0) and KWD (3),
      // not just USD. Only an explicit field setting overrides it.
      decimals: opts?.decimals,
      currencyDisplay: opts?.currencyDisplay ?? 'symbol',
    }
  }, [field.options, orgCurrency])

  /**
   * Handle value change from CurrencyInput.
   * This is called AFTER the UI component parses the value on blur.
   */
  const handleValueChange = useCallback(
    (next: number | undefined) => {
      const newValue = next ?? null
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
        // Blur triggers: parse -> onValueChange -> save (via shouldSaveRef).
        e.currentTarget.blur()
        // Closes the PropertyContext (used by the drawer/popover case). For
        // inline cell editing, InlineCellEditor's document keydown listener
        // handles exit + row advancement after this commit completes.
        close()
      }
    },
    [close]
  )

  return (
    <CurrencyInput
      value={readCurrency(value)}
      onValueChange={handleValueChange}
      currencyCode={options.currencyCode}
      currencyDisplay={options.currencyDisplay === 'compact' ? 'symbol' : options.currencyDisplay}
      decimals={options.decimals}
      disabled={isSaving}>
      <InputGroup className={cn('h-[27px] ring-0! border-0', isSaving ? 'opacity-70' : '')}>
        <BaseCurrencyInputField
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder='0.00'
          autoFocus
          className='text-left pl-0!'
        />
      </InputGroup>
    </CurrencyInput>
  )
}
