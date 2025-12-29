// components/tickets/MultiSelectUsers.tsx
import React from 'react'
import MultipleSelector, { Option } from '@auxx/ui/components/multiselect'
import { api } from '~/trpc/react'

type MultiSelectUsersProps = {
  value: Option[]
  onChange: (value: Option[]) => void
  placeholder?: string
  emptyIndicator?: string
}

export function MultiSelectUsers({
  value,
  onChange,
  placeholder = 'Select assignees',
  emptyIndicator = 'No team members found',
}: MultiSelectUsersProps) {
  const { data: teamMembers, isLoading } = api.user.teamMembers.useQuery()

  // Build options array including special options
  const options: Option[] = [
    { value: 'UNASSIGNED', label: 'Unassigned' },
    // { value: 'ME', label: 'Assigned to me' },
  ]

  // Add team members
  if (teamMembers) {
    teamMembers.forEach((member) => {
      options.push({ value: member.id, label: member.name || member.id })
    })
  }
  // console.log(options, value)
  return (
    <MultipleSelector
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      emptyIndicator={isLoading ? 'Loading...' : emptyIndicator}
    />
  )
}

// Add this component to the updated-ticket-filters.tsx imports
