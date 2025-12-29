// apps/web/src/components/workflow/nodes/shared/node-inputs/string-input.tsx

import React, { useState, useEffect } from 'react'
import { AutosizeField } from '@auxx/ui/components/autosize-field'
import { createNodeInput, type NodeInputProps } from './base-node-input'
import { Input } from '@auxx/ui/components/input'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'

interface StringInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Placeholder text */
  placeholder?: string
  /** Use textarea for multiline input */
  multiline?: boolean
  /** Validation type */
  validationType?: 'email' | 'url' | 'phone' | 'text'
  /** Min length */
  minLength?: number
  /** Max length */
  maxLength?: number
}

/**
 * String input component with validation
 */
export const StringInput = createNodeInput<StringInputProps>(
  ({
    inputs,
    errors,
    onChange,
    onError,
    isLoading,
    name,
    placeholder,
    multiline,
    validationType,
    minLength,
    maxLength,
  }) => {
    // Local state for immediate UI updates
    const [localValue, setLocalValue] = useState(inputs[name] ?? '')

    // Sync local state when parent value changes externally
    useEffect(() => {
      setLocalValue(inputs[name] ?? '')
    }, [inputs[name]])

    // Debounced validation and parent update (300ms)
    const debouncedUpdate = useDebouncedCallback((newValue: string) => {
      // Basic validation - use callback instead of mutation
      if (validationType === 'email' && newValue && !isValidEmail(newValue)) {
        onError(name, 'Invalid email address')
      } else if (validationType === 'url' && newValue && !isValidUrl(newValue)) {
        onError(name, 'Invalid URL')
      } else if (validationType === 'phone' && newValue && !isValidPhone(newValue)) {
        onError(name, 'Invalid phone number')
      } else if (minLength && newValue.length < minLength) {
        onError(name, `Minimum length is ${minLength}`)
      } else if (maxLength && newValue.length > maxLength) {
        onError(name, `Maximum length is ${maxLength}`)
      } else {
        onError(name, null) // Clear error
      }

      // Update parent
      onChange(name, newValue)
    }, 300)

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const newValue = e.target.value
      // Update local state immediately for responsive UI
      setLocalValue(newValue)
      // Debounced validation and parent update
      debouncedUpdate(newValue)
    }

    const inputId = `input-${name}`

    // Return just the input component without wrappers or error displays
    if (multiline) {
      return (
        <AutosizeField
          variant="transparent"
          className="px-0 min-h-8"
          id={inputId}
          value={localValue}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={isLoading}
          minRows={1}
          maxRows={10}
        />
      )
    }

    return (
      <Input
        variant="transparent"
        className="px-0 min-h-8"
        size="sm"
        autoComplete="off"
        // className="w-full text-sm input-editor-field focus:outline-none focus:ring-0 h-6.5"
        id={inputId}
        type={getInputType(validationType)}
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={isLoading}
        minLength={minLength}
        maxLength={maxLength}
      />
    )
  }
)

// Validation helpers
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

function isValidPhone(phone: string): boolean {
  return /^[\+]?[1-9][\d\s\-\(\)\.]{7,15}$/.test(phone.replace(/\s/g, ''))
}

function getInputType(validationType?: string): string {
  switch (validationType) {
    case 'email':
      return 'email'
    case 'url':
      return 'url'
    case 'phone':
      return 'tel'
    default:
      return 'text'
  }
}
