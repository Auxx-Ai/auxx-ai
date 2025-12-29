'use client'

import React, { useImperativeHandle } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { type TeamMember } from './mention-extension'

/**
 * Props for the MentionPopover component
 */
interface MentionPopoverProps {
  teamMembers: TeamMember[]
  query: string
  onSelect: (member: TeamMember) => void
}

/**
 * Custom interface for the mention popover ref
 */
interface MentionPopoverRef {
  onKeyDown?: (event: KeyboardEvent) => boolean
}

/**
 * Popover component for displaying and selecting team members in mentions
 * Uses shadcn Command component for better UX with built-in keyboard navigation
 * This component is rendered by TipTap's ReactRenderer
 */
type Props = MentionPopoverProps & React.RefAttributes<MentionPopoverRef>
export const MentionPopover: React.FC<Props> = ({
  teamMembers = [],
  query = '',
  onSelect,
  ref,
}) => {
  const divRef = React.useRef<HTMLDivElement>(null)

  // Filter team members based on query
  const filteredMembers = React.useMemo(() => {
    if (!Array.isArray(teamMembers)) return []

    return teamMembers.filter((member) => {
      if (!member || typeof member !== 'object') return false
      if (!query) return true // Show all if no query
      return member.name?.toLowerCase().includes(query.toLowerCase())
    })
  }, [teamMembers, query])

  // Handle member selection with safety checks
  const handleSelect = React.useCallback(
    (member: TeamMember) => {
      if (member && onSelect && typeof onSelect === 'function') {
        onSelect(member)
      }
    },
    [onSelect]
  )

  // Expose methods for parent components
  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      // This method can be called by parent components if needed
      return false
    },
  }))

  return (
    <div ref={divRef} className="w-60 rounded-lg border bg-popover shadow-lg">
      <Command>
        <CommandList className="max-h-48">
          <CommandEmpty>No team members found</CommandEmpty>
          <CommandGroup heading="Team Members">
            {filteredMembers.map((member) => (
              <CommandItem
                key={member.id}
                value={member.name || ''}
                onSelect={() => handleSelect(member)}
                className="flex items-center gap-3 px-3 py-2">
                <Avatar className="h-6 w-6">
                  <AvatarImage src={member.image || undefined} alt={member.name || ''} />
                  <AvatarFallback className="text-xs">
                    {member.name
                      ?.split(' ')
                      .map((n) => n[0])
                      .join('')
                      .toUpperCase() || '?'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{member.name || 'Unknown User'}</div>
                  {member.email && (
                    <div className="text-xs text-muted-foreground truncate">{member.email}</div>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  )
}

MentionPopover.displayName = 'MentionPopover'
