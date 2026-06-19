// apps/web/src/components/workflow/nodes/shared/node-inputs/string-input.tsx

import { AutosizeField } from '@auxx/ui/components/autosize-field'
import { AutosizeInput } from '@auxx/ui/components/autosize-input'
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { cn } from '@auxx/ui/lib/utils'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import type { PickerTriggerOptions } from '~/components/ui/picker-trigger'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { createNodeInput, type NodeInputProps } from './base-node-input'

/** AutoGrow options for text inputs */
interface AutoGrowOptions {
  minWidth?: number
  maxWidth?: number
  placeholderIsMinWidth?: boolean
}

interface StringInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Placeholder text */
  placeholder?: string
  /** Use textarea for multiline input */
  multiline?: boolean
  /** Mask the value (single-line only) and show a reveal toggle. For secrets/passwords. */
  secret?: boolean
  /** Validation type */
  validationType?: 'email' | 'url' | 'phone' | 'text'
  /** Min length */
  minLength?: number
  /** Max length */
  maxLength?: number
  /** Additional className for the input */
  className?: string
  /** Enable auto-grow for text inputs */
  autoGrow?: AutoGrowOptions
  /** Trigger customization options (className is merged into the input) */
  triggerProps?: PickerTriggerOptions
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
    secret,
    validationType,
    minLength,
    maxLength,
    className,
    autoGrow,
    triggerProps,
  }) => {
    // Local state for immediate UI updates
    const [localValue, setLocalValue] = useState(inputs[name] ?? '')
    // Reveal state for masked (secret) inputs
    const [revealed, setRevealed] = useState(false)

    // Sync local state when parent value changes externally
    useEffect(() => {
      setLocalValue(inputs[name] ?? '')
    }, [inputs[name], name])

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
    const baseClassName = 'px-0 min-h-8'

    // Return just the input component without wrappers or error displays
    if (multiline) {
      return (
        <AutosizeField
          variant='transparent'
          className={cn(baseClassName, className, triggerProps?.className)}
          id={inputId}
          value={localValue}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={isLoading}
          autoComplete='one-time-code'
          minRows={1}
          maxRows={10}
        />
      )
    }

    // Masked single-line input with a reveal toggle (secrets/passwords).
    if (secret) {
      return (
        <InputGroup
          className={cn(
            baseClassName,
            // No focus ring — zero out InputGroup's has-[…]:ring-[1px] focus-within ring.
            'bg-transparent dark:bg-transparent border-0 shadow-none outline-none text-sm px-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0',
            className,
            triggerProps?.className
          )}>
          <InputGroupInput
            id={inputId}
            className='pl-0 placeholder:text-primary-400'
            type={revealed ? 'text' : 'password'}
            autoComplete='one-time-code'
            value={localValue}
            onChange={handleChange}
            placeholder={placeholder}
            disabled={isLoading}
            minLength={minLength}
            maxLength={maxLength}
          />
          <InputGroupAddon align='inline-end'>
            <InputGroupButton
              type='button'
              aria-label={revealed ? 'Hide value' : 'Show value'}
              aria-pressed={revealed}
              size='icon-xs'
              onClick={() => setRevealed((prev) => !prev)}>
              {revealed ? (
                <EyeOffIcon size={16} aria-hidden='true' />
              ) : (
                <EyeIcon size={16} aria-hidden='true' />
              )}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      )
    }

    // Use AutosizeInput when autoGrow is provided
    if (autoGrow) {
      return (
        <AutosizeInput
          value={localValue}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={isLoading}
          type={getInputType(validationType)}
          minWidth={autoGrow.minWidth}
          maxWidth={autoGrow.maxWidth}
          placeholderIsMinWidth={autoGrow.placeholderIsMinWidth}
          autoComplete='one-time-code'
          inputClassName={cn(
            'bg-transparent border-0 outline-none focus:ring-0 text-sm',
            baseClassName,
            className,
            triggerProps?.className
          )}
        />
      )
    }

    return (
      <Input
        variant='transparent'
        className={cn(baseClassName, className, triggerProps?.className)}
        size='sm'
        autoComplete='one-time-code'
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
  return /^[+]?[1-9][\d\s\-().]{7,15}$/.test(phone.replace(/\s/g, ''))
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
