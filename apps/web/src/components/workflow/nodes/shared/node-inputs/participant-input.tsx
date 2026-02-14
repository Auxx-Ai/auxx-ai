// apps/web/src/components/workflow/nodes/shared/node-inputs/participant-input.tsx

import { Label } from '@auxx/ui/components/label'
import React from 'react'
import { ParticipantPicker } from '~/components/pickers/participant-picker'
import { createNodeInput, type NodeInputProps } from './base-node-input'

interface ParticipantInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Allow multiple participants */
  allowMultiple?: boolean
  /** Participant type filter */
  type?: 'from' | 'to' | 'cc' | 'any'
}

/**
 * Participant input component using ParticipantPicker
 */
export const ParticipantInput = createNodeInput<ParticipantInputProps>(
  ({ inputs, errors, onChange, onError, isLoading, name, allowMultiple = false, type = 'any' }) => {
    const value = inputs[name]
    const error = errors[name]

    // Handle single vs multiple participants
    const selectedEmails = allowMultiple
      ? (value as any[])?.map((p) => p.email || p) || []
      : value?.email
        ? [value.email]
        : []

    const handleChange = (emails: string[]) => {
      if (allowMultiple) {
        // Convert emails to participant objects
        const participants = emails.map((email) => ({ email, name: '' }))
        onChange(name, participants)
      } else {
        // Single participant
        const participant = emails[0] ? { email: emails[0], name: '' } : null
        onChange(name, participant)
      }
    }

    const inputId = `input-${name}`

    // Return just the ParticipantPicker without wrappers or error displays
    return (
      <ParticipantPicker
        selected={selectedEmails}
        onChange={handleChange}
        allowMultiple={allowMultiple}
        placeholder={allowMultiple ? 'Select participants' : 'Select participant'}
        disabled={isLoading}
        type={type}
      />
    )
  }
)
