// apps/web/src/components/workflow/nodes/shared/node-inputs/phone-input.tsx

import PhoneInputWithFlag from '@auxx/ui/components/phone-input'
import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { createNodeInput, type NodeInputProps } from './base-node-input'

/**
 * Props for PhoneInput node component
 */
interface PhoneInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Placeholder text */
  placeholder?: string
}

/**
 * Phone input component for workflow nodes
 * Uses PhoneInputWithFlag for international phone number entry with country picker
 */
export const PhoneInput = createNodeInput<PhoneInputProps>(
  ({ inputs, onChange, onError, isLoading, name, placeholder = 'Enter phone number' }) => {
    // Local state for immediate UI updates
    const [localValue, setLocalValue] = useState(inputs[name] ?? '')

    // Sync local state when parent value changes externally
    useEffect(() => {
      setLocalValue(inputs[name] ?? '')
    }, [inputs[name], name])

    /**
     * Handle phone value change - update local state immediately
     */
    const handleChange = useCallback(
      (value: string) => {
        setLocalValue(value)
        onError(name, null) // Clear any previous error
        onChange(name, value)
      },
      [name, onChange, onError]
    )

    /**
     * Handle Enter key - blur to finalize (consistent with other inputs)
     */
    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.currentTarget.blur()
      }
    }, [])

    return (
      <PhoneInputWithFlag
        value={localValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isLoading}
        className='h-7 shadow-none! border-none ring-0! outline-none focus:ring-0 [&>input]:h-7 [&>input]:outline-none [&>input]:focus:ring-0 [&_[data-slot=country-select]]:bg-transparent [&_[data-slot=phone-input]]:w-full [&_[data-slot=phone-input]]:flex-1'
      />
    )
  }
)
