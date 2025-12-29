// apps/web/src/components/contacts/input/rich-text-input-field.tsx
import { usePropertyContext } from '../drawer/property-provider'
import { useRef, useEffect, useState } from 'react'

/**
 * RichTextInputField
 * Editor for rich text field type (simple textarea for now)
 *
 * Pattern A: Text-based input
 * - Local state for responsive typing
 * - trackChange marks dirty on each keystroke
 * - commitValue fires on blur (fire-and-forget)
 * - Does NOT capture arrow keys (allows row navigation)
 *
 * Note: Shift+Enter adds newline, Enter triggers close via FieldInput
 */
export function RichTextInputField() {
  const { value, trackChange, commitValue, isSaving } = usePropertyContext()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [inputValue, setInputValue] = useState(value || '')

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
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
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

  return (
    <textarea
      ref={inputRef}
      className={`w-full rounded px-2 py-1 text-sm outline-none focus:ring-0 border-none min-h-[60px] ${isSaving ? 'opacity-70' : ''}`}
      value={inputValue}
      onChange={handleChange}
      onBlur={handleBlur}
      disabled={isSaving}
      autoFocus
    />
  )
}
