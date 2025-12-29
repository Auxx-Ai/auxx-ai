'use client'

import React from 'react'
import { StatusSlug } from '~/components/mail/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { getStatusOptionsForDropdown, type StatusOption } from '../_utils/mailbox-utils'
import { formatStatusSlugForDisplay } from '../_utils/mail-utils'

/**
 * Props for the MailboxStatusDropdown component
 */
interface MailboxStatusDropdownProps {
  /** Available status options to display */
  availableStatuses: StatusSlug[]
  /** Currently selected status */
  selectedStatus: StatusSlug
  /** Callback when status selection changes */
  onStatusChange: (status: StatusSlug) => void
  /** Optional className for styling */
  className?: string
  /** Whether the dropdown is disabled */
  disabled?: boolean
}

/**
 * Dropdown component for selecting mailbox status/filter
 * Replaces the previous tab-based status selection
 */
export function MailboxStatusDropdown({
  availableStatuses,
  selectedStatus,
  onStatusChange,
  className = '',
  disabled = false,
}: MailboxStatusDropdownProps) {
  // Get formatted options for the dropdown
  const statusOptions = getStatusOptionsForDropdown(availableStatuses)

  // Handle selection change
  const handleValueChange = (value: string) => {
    onStatusChange(value as StatusSlug)
  }

  // Don't render if no statuses available
  if (availableStatuses.length === 0) {
    return null
  }

  return (
    <Select value={selectedStatus} onValueChange={handleValueChange} disabled={disabled}>
      <SelectTrigger className={`w-auto min-w-[120px] ${className}`} size="sm">
        <SelectValue>{formatStatusSlugForDisplay(selectedStatus)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {statusOptions.map((option) => (
          <SelectItem key={option.value} value={option.value} className="cursor-pointer">
            <div className="flex flex-col">
              <span className="font-medium">{option.label}</span>
              {option.description && (
                <span className="text-xs text-muted-foreground">{option.description}</span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
