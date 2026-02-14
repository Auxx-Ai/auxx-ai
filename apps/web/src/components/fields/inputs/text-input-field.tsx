// apps/web/src/components/fields/inputs/text-input-field.tsx

import { AutosizeField } from '@auxx/ui/components/autosize-field'
import { useEffect, useRef, useState } from 'react'
import { useIsInlineEditor } from '~/components/dynamic-table/components/inline-cell-editor'
import { usePropertyContext } from '../property-provider'

/**
 * TextInputField
 * Editor for text field type with auto-expanding textarea
 *
 * Pattern A: Text-based input
 * - Local state for responsive typing
 * - trackChange marks dirty on each keystroke
 * - commitValue fires on blur (fire-and-forget)
 * - commitAndClose on Enter
 * - Auto-expands as content grows
 * - Does NOT capture arrow keys (allows row navigation)
 */
export function TextInputField() {
  const { value, trackChange, commitValue, commitValueAndClose, isSaving } = usePropertyContext()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [inputValue, setInputValue] = useState(value ?? '')
  const isInline = useIsInlineEditor()

  // Sync local state when value changes externally
  useEffect(() => {
    setInputValue(value ?? '')
  }, [value])

  useEffect(() => {
    if (inputRef.current) {
      const textarea = inputRef.current
      textarea.focus()
      // Move cursor to end
      const len = textarea.value.length
      textarea.setSelectionRange(len, len)
    }
  }, [])

  // Force AutosizeField to recalculate height when value changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: inputValue triggers resize recalculation
  useEffect(() => {
    window.dispatchEvent(new Event('resize'))
  }, [inputValue])

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

  /**
   * Handle keyboard - Enter saves and closes, Shift+Enter for newline
   * Arrow keys are handled by FieldInput for row navigation
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      e.stopPropagation() // Prevent parent handlers from reopening
      if (!e.shiftKey) {
        e.preventDefault() // Plain Enter: save & close
        commitValueAndClose(inputValue)
      }
      // Shift+Enter: let it insert newline
    }
  }

  return (
    <AutosizeField
      ref={inputRef}
      minRows={1}
      maxRows={10}
      autoWidth={isInline}
      maxWidth={isInline ? 280 : undefined}
      className={`w-full rounded px-2 py-1 text-sm outline-none focus:ring-0 focus-visible:ring-0 border-none bg-transparent
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
