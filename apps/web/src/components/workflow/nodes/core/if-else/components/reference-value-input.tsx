// apps/web/src/components/workflow/nodes/core/if-else/components/reference-value-input.tsx

import React from 'react'
import { ThreadPicker } from '~/components/pickers/thread-picker'
import { ParticipantPicker } from '~/components/pickers/participant-picker'
import { Input } from '@auxx/ui/components/input'

/**
 * Props for the ReferenceValueInput component
 */
interface ReferenceValueInputProps {
  referenceTarget?: string
  value?: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}

/**
 * Component for handling reference type value inputs in if-else conditions
 * Dynamically renders appropriate picker based on the reference target
 */
export function ReferenceValueInput({
  referenceTarget,
  value,
  onChange,
  disabled,
  placeholder,
}: ReferenceValueInputProps) {
  // Dynamically render appropriate picker based on referenceTarget
  switch (referenceTarget) {
    case 'thread':
      return (
        <ThreadPicker
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder || 'Select a thread'}
        />
      )

    case 'participant':
      return (
        <ParticipantPicker
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder || 'Select a participant'}
          multiple={false}
        />
      )

    case 'message':
      // TODO: Implement MessagePicker when available
      // For now, use a simple input for message IDs
      return (
        <Input
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder || 'Enter message ID'}
          className="h-8 text-xs"
        />
      )

    default:
      // Generic reference input for unknown reference types
      return (
        <Input
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder || `Enter ${referenceTarget || 'reference'} ID`}
          className="h-8 text-xs"
        />
      )
  }
}
