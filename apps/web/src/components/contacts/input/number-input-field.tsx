// apps/web/src/components/contacts/input/number-input-field.tsx
import { usePropertyContext } from '../drawer/property-provider'
import { useFieldNavigationOptional } from '../drawer/field-navigation-context'
import { useRef, useEffect, useCallback } from 'react'
import {
  NumberInput,
  NumberInputField as NumberInputFieldBase,
  NumberInputArrows,
} from '@auxx/ui/components/input-number'
import { InputGroup } from '@auxx/ui/components/input-group'
import { cn } from '@auxx/ui/lib/utils'

/**
 * NumberInputField
 * Editor for number field type using NumberInput with arrows
 *
 * Keyboard behavior:
 * - ArrowUp/Down: Increment/decrement value (handled by NumberInputFieldBase)
 * - Enter: Accept value and close popover
 * - Blur: Save value (fire-and-forget)
 *
 * Note: CAPTURES arrow keys for value changes, not row navigation.
 */
export function NumberInputField() {
  const { value, trackChange, commitValue, close, isSaving } = usePropertyContext()
  const nav = useFieldNavigationOptional()
  const inputRef = useRef<HTMLInputElement>(null)

  // Capture keys while open (arrows used for increment/decrement)
  useEffect(() => {
    nav?.setPopoverCapturing(true)
    return () => nav?.setPopoverCapturing(false)
  }, [nav])

  // Track the latest value for saving on blur
  const latestValueRef = useRef<number | null>(typeof value === 'number' ? value : null)

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus()
  }, [])

  /**
   * Handle value change from NumberInput (arrow buttons or typing+blur)
   * Marks dirty - save happens on blur
   */
  const handleValueChange = useCallback(
    (newValue: number | undefined) => {
      const val = newValue ?? null
      latestValueRef.current = val
      trackChange(val)
    },
    [trackChange]
  )

  /**
   * Handle blur - fire-and-forget save
   */
  const handleBlur = useCallback(() => {
    commitValue(latestValueRef.current)
  }, [commitValue])

  /**
   * Handle Enter key - blur to trigger parse, then close
   * The blur triggers NumberInputFieldBase to parse and commit the value,
   * which then triggers our handleBlur to save.
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        // Blur triggers: parse -> onValueChange -> handleBlur -> commitValue
        e.currentTarget.blur()
        // Close the popover (value already saved by handleBlur)
        close()
      }
    },
    [close]
  )

  return (
    <NumberInput
      value={typeof value === 'number' ? value : undefined}
      onValueChange={handleValueChange}
      disabled={isSaving}>
      <InputGroup className={cn('h-[27px] ring-0! border-0', isSaving ? 'opacity-70' : '')}>
        <NumberInputFieldBase
          ref={inputRef}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          autoFocus
          className="text-left ps-2"
        />
        <NumberInputArrows />
      </InputGroup>
    </NumberInput>
  )
}
