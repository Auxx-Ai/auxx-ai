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
import { EyeIcon, EyeOffIcon, Undo2Icon } from 'lucide-react'
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
  /**
   * Marks a secret input as backing a STORED value (the value is this sentinel, e.g. `HIDDEN_VALUE`).
   * The field then shows a masked placeholder + a "Replace" action instead of an editable box, so
   * overwriting a stored secret is deliberate; "Cancel" restores this value (keep existing). Omit
   * for a fresh secret entry (plain editable masked input).
   */
  revertValue?: string
  /** Validation type */
  validationType?: 'email' | 'url' | 'phone' | 'text'
  /** Min length */
  minLength?: number
  /** Max length */
  maxLength?: number
  /** Regex the value must match (validated live as the user edits). */
  pattern?: string
  /** Message shown when `pattern` fails. */
  patternMessage?: string
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
    revertValue,
    validationType,
    minLength,
    maxLength,
    pattern,
    patternMessage,
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
      } else if (pattern && newValue && !new RegExp(pattern).test(newValue)) {
        onError(name, patternMessage ?? 'Invalid format')
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
      const groupClassName = cn(
        baseClassName,
        // No focus ring — zero out InputGroup's has-[…]:ring-[1px] focus-within ring.
        'bg-transparent dark:bg-transparent border-0 shadow-none outline-none text-sm px-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0',
        className,
        triggerProps?.className
      )

      // A stored secret the user hasn't touched: the form value is the sentinel (`revertValue`). We
      // don't expose an editable field over it — show a masked-looking placeholder + an explicit
      // Replace action, so overwriting a secret is deliberate, not a stray keystroke.
      const hasSavedSecret = revertValue !== undefined
      const isSavedUntouched = hasSavedSecret && localValue === revertValue

      if (isSavedUntouched) {
        return (
          <InputGroup className={groupClassName}>
            <InputGroupInput
              id={inputId}
              className='pl-0 placeholder:text-primary-400'
              type='password'
              value=''
              readOnly
              aria-label='Saved secret'
              placeholder='••••••••••••'
              disabled={isLoading}
            />
            <InputGroupAddon align='inline-end'>
              <InputGroupButton
                type='button'
                className='rounded-lg hover:bg-primary-200'
                variant='ghost'
                size='xs'
                disabled={isLoading}
                onClick={() => {
                  debouncedUpdate.cancel()
                  setRevealed(false)
                  onError(name, null)
                  setLocalValue('')
                  onChange(name, '') // enter edit mode with an empty field
                  requestAnimationFrame(() => document.getElementById(inputId)?.focus())
                }}>
                Replace
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        )
      }

      // Edit mode: a fresh connect, or replacing a stored secret. Editable masked input + reveal
      // toggle, plus a Cancel that restores the stored secret (when there was one) so the user can
      // back out of a replace without re-typing.
      const cancelReplace = () => {
        debouncedUpdate.cancel()
        setLocalValue(revertValue as string)
        setRevealed(false)
        onError(name, null)
        onChange(name, revertValue as string)
      }
      return (
        <InputGroup className={groupClassName}>
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
          <InputGroupAddon align='inline-end' className='gap-0'>
            {hasSavedSecret && (
              <InputGroupButton
                type='button'
                aria-label='Keep saved value'
                title='Keep saved value'
                size='icon-xs'
                disabled={isLoading}
                onClick={cancelReplace}>
                <Undo2Icon size={16} aria-hidden='true' />
              </InputGroupButton>
            )}
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
