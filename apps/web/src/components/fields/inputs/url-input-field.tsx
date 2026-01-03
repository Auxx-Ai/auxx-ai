// apps/web/src/components/fields/inputs/url-input-field.tsx
import { usePropertyContext } from '../property-provider'
import { useRef, useEffect, useState } from 'react'

/**
 * UrlInputField
 * Editor for URL field type
 *
 * Pattern A: Text-based input
 * - Local state for responsive typing
 * - trackChange marks dirty on each keystroke
 * - commitValue fires on blur (fire-and-forget) with URL formatting
 * - commitAndClose on Enter
 * - Does NOT capture arrow keys (allows row navigation)
 */
export function UrlInputField() {
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
   * Format URL by adding https:// if no protocol present
   */
  const formatUrl = (url: string): string => {
    let formattedUrl = url.trim()
    if (formattedUrl && !formattedUrl.match(/^[a-zA-Z]+:\/\//)) {
      formattedUrl = `https://${formattedUrl}`
    }
    return formattedUrl
  }

  /**
   * Handle blur - format URL and fire-and-forget save
   */
  const handleBlur = () => {
    const formattedUrl = formatUrl(inputValue)
    if (formattedUrl !== inputValue) {
      setInputValue(formattedUrl)
    }
    commitValue(formattedUrl)
  }

  /**
   * Handle Enter key - save and close
   * Arrow keys are handled by FieldInput for row navigation
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()  // Prevent parent from reopening
      // Format URL before saving
      const formattedUrl = formatUrl(inputValue)
      if (formattedUrl !== inputValue) {
        setInputValue(formattedUrl)
      }
      commitValueAndClose(formattedUrl)
    }
  }

  return (
    <input
      ref={inputRef}
      type="url"
      className={`w-full rounded px-2 py-1 text-sm outline-none focus:ring-0 border-none
                ${isSaving ? 'opacity-70' : ''}`}
      value={inputValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      disabled={isSaving}
      autoFocus
    />
  )
}
