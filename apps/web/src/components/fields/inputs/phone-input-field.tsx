// apps/web/src/components/fields/inputs/phone-input-field.tsx
import PhoneInputWithFlag from '@auxx/ui/components/phone-input'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePropertyContext } from '../property-provider'

/**
 * PhoneInputField
 * Editor for phone field type with international flag picker
 *
 * Keyboard behavior:
 * - Enter: Save value and close popover
 * - Blur/Close: Save value (fire-and-forget)
 */
export function PhoneInputField() {
  const { value, commitValue, onBeforeClose, close, isSaving } = usePropertyContext()
  const [phoneValue, setPhoneValue] = useState(value || '')

  // Keep ref in sync for save-on-close
  const phoneValueRef = useRef(phoneValue)
  useEffect(() => {
    phoneValueRef.current = phoneValue
  }, [phoneValue])

  /**
   * Handle phone value change - local state only
   */
  function handleChange(value: string) {
    setPhoneValue(value)
  }

  // Register save handler for popover close - fire-and-forget
  useEffect(() => {
    onBeforeClose.current = () => {
      if (phoneValueRef.current !== value) {
        commitValue(phoneValueRef.current)
      }
    }
    return () => {
      onBeforeClose.current = undefined
    }
  }, [onBeforeClose, value, commitValue])

  /**
   * Handle Enter key - save and close
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation() // Prevent container from reopening
        if (phoneValueRef.current !== value) {
          commitValue(phoneValueRef.current)
        }
        close()
      }
    },
    [value, commitValue, close]
  )

  return (
    <PhoneInputWithFlag
      value={phoneValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      autoFocus
      className={`h-7 border-none outline-none focus:ring-0 [&>input]:h-7 [&>input]:w-40 [&>input]:outline-none [&>input]:focus:ring-0 ${isSaving ? 'opacity-70' : ''}`}
      disabled={isSaving}
    />
  )
}
