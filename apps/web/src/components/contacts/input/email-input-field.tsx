// apps/web/src/components/contacts/input/email-input-field.tsx
import { usePropertyContext } from '../drawer/property-provider'
import { useRef, useEffect, useState } from 'react'

/**
 * EmailInputField
 * Editor for email field type
 *
 * Pattern A: Text-based input
 * - Local state for responsive typing
 * - trackChange marks dirty on each keystroke
 * - commitValue fires on blur (fire-and-forget)
 * - commitAndClose on Enter
 * - Does NOT capture arrow keys (allows row navigation)
 */
export function EmailInputField() {
  const { value, trackChange, commitValue, commitValueAndClose, isSaving } = usePropertyContext()
  const inputRef = useRef<HTMLInputElement>(null)
  const [inputValue, setInputValue] = useState(value ?? '')

  // Sync local state when value changes externally
  useEffect(() => {
    setInputValue(value ?? '')
  }, [value])

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus()
  }, [])

  /**
   * Handle input change - update local state and track dirty
   */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setInputValue(newValue)
    trackChange(newValue)
  }

  /**
   * Handle blur - fire-and-forget save
   */
  const handleBlur = () => {
    commitValue(inputValue)
  }

  /**
   * Handle Enter key - save and close
   * Arrow keys are handled by FieldInput for row navigation
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()  // Prevent parent from reopening
      commitValueAndClose(inputValue)
    }
  }

  return (
    <input
      ref={inputRef}
      type="email"
      className={`w-full rounded px-2 py-1 text-sm outline-none focus:ring-0 border-none
                ${isSaving ? 'opacity-70' : ''}`}
      value={inputValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      disabled={isSaving}
      autoFocus
    />
  )
}
