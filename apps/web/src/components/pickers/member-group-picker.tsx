// /app/settings/inbox/_components/member-group-popover.tsx
'use client'

import React, { useState } from 'react'
import { Users } from 'lucide-react'
import { useDebounce } from '~/hooks/use-debounced-value'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { cn } from '@auxx/ui/lib/utils'
import { useMembersGroups } from '~/hooks/use-members-groups'

interface MemberGroupPickerProps {
  children: React.ReactNode
  selectedMembers?: string[] // Can be either member IDs or user IDs
  selectedGroups?: string[]
  onChange?: (selection: { memberIds: string[]; userIds: string[]; groupIds: string[] }) => void
  placement?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  className?: string
  disabled?: boolean
  useUserIds?: boolean // If true, selectedMembers contains user IDs instead of member IDs
}

export function MemberGroupPicker({
  children,
  selectedMembers = [],
  selectedGroups = [],
  onChange,
  placement = 'bottom',
  align = 'start',
  className,
  disabled = false,
  useUserIds = false,
}: MemberGroupPickerProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery] = useDebounce(searchQuery, 300)

  // Internal state for selected items
  const [internalSelectedMembers, setInternalSelectedMembers] = useState<string[]>(selectedMembers)
  const [internalSelectedGroups, setInternalSelectedGroups] = useState<string[]>(selectedGroups)

  // Convert between user IDs and member IDs if needed
  const getDisplayMemberIds = () => {
    if (!useUserIds) return internalSelectedMembers
    // If using user IDs, convert back to member IDs for display
    return internalSelectedMembers
      .map((userId) => filteredMembers.find((member) => member.userId === userId)?.id)
      .filter(Boolean) as string[]
  }

  // Fetch members and groups data
  const { members, groups, isLoading } = useMembersGroups(debouncedSearchQuery)

  // Filter members and groups based on search query (additional client-side filtering)
  const filteredMembers =
    members?.filter(
      (member) =>
        member.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (member.email && member.email.toLowerCase().includes(searchQuery.toLowerCase()))
    ) || []

  const filteredGroups =
    groups?.filter((group) => group.name.toLowerCase().includes(searchQuery.toLowerCase())) || []

  // Toggle selection for a member
  const toggleMember = (idToToggle: string) => {
    let newSelection: string[]

    if (internalSelectedMembers.includes(idToToggle)) {
      newSelection = internalSelectedMembers.filter((id) => id !== idToToggle)
    } else {
      newSelection = [...internalSelectedMembers, idToToggle]
    }

    setInternalSelectedMembers(newSelection)

    if (onChange) {
      if (useUserIds) {
        // If using user IDs, newSelection contains user IDs, map to member IDs for memberIds
        const selectedMemberIds = newSelection
          .map((userId) => filteredMembers.find((member) => member.userId === userId)?.id)
          .filter(Boolean) as string[]

        onChange({
          memberIds: selectedMemberIds,
          userIds: newSelection,
          groupIds: internalSelectedGroups,
        })
      } else {
        // If using member IDs, newSelection contains member IDs, map to user IDs for userIds
        const selectedUserIds = newSelection
          .map((memberId) => filteredMembers.find((member) => member.id === memberId)?.userId)
          .filter(Boolean) as string[]

        onChange({
          memberIds: newSelection,
          userIds: selectedUserIds,
          groupIds: internalSelectedGroups,
        })
      }
    }
  }

  // Toggle selection for a group
  const toggleGroup = (groupId: string) => {
    let newSelection: string[]

    if (internalSelectedGroups.includes(groupId)) {
      newSelection = internalSelectedGroups.filter((id) => id !== groupId)
    } else {
      newSelection = [...internalSelectedGroups, groupId]
    }

    setInternalSelectedGroups(newSelection)

    if (onChange) {
      if (useUserIds) {
        // If using user IDs, internalSelectedMembers contains user IDs, map to member IDs for memberIds
        const selectedMemberIds = internalSelectedMembers
          .map((userId) => filteredMembers.find((member) => member.userId === userId)?.id)
          .filter(Boolean) as string[]

        onChange({
          memberIds: selectedMemberIds,
          userIds: internalSelectedMembers,
          groupIds: newSelection,
        })
      } else {
        // If using member IDs, internalSelectedMembers contains member IDs, map to user IDs for userIds
        const selectedUserIds = internalSelectedMembers
          .map((memberId) => filteredMembers.find((member) => member.id === memberId)?.userId)
          .filter(Boolean) as string[]

        onChange({
          memberIds: internalSelectedMembers,
          userIds: selectedUserIds,
          groupIds: newSelection,
        })
      }
    }
  }

  // Handle popover close - sync internal state with external state
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && !open) {
      // If closing the popover, reset internal state to match external state
      setInternalSelectedMembers(selectedMembers)
      setInternalSelectedGroups(selectedGroups)
    }
    setOpen(newOpen)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        {children}
      </PopoverTrigger>
      <PopoverContent className={cn('w-[300px] p-0', className)} align={align} side={placement}>
        <Command>
          <CommandInput
            placeholder="Search members or groups..."
            value={searchQuery}
            onValueChange={setSearchQuery}
            className="h-9"
          />
          <CommandList className="max-h-[300px] overflow-auto">
            <CommandEmpty>No results found.</CommandEmpty>

            {/* Groups section */}
            {filteredGroups.length > 0 && (
              <CommandGroup heading="Groups:">
                {filteredGroups.map((group) => (
                  <CommandItem
                    key={group.id}
                    onSelect={() => toggleGroup(group.id)}
                    className="flex items-center justify-between p-1">
                    <div className="flex items-center">
                      <Users className="mr-2 size-4 text-muted-foreground" />
                      <span>{group.name}</span>
                      <Badge variant="outline" className="ml-2">
                        {group.memberCount}
                      </Badge>
                    </div>
                    <Checkbox
                      checked={internalSelectedGroups.includes(group.id)}
                      onCheckedChange={() => toggleGroup(group.id)}
                      aria-label={`Select ${group.name}`}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Members section */}
            {filteredMembers.length > 0 && (
              <CommandGroup heading="Members:">
                {filteredMembers.map((member) => (
                  <CommandItem
                    key={member.id}
                    onSelect={() => toggleMember(useUserIds ? member.userId : member.id)}
                    className="flex items-center justify-between py-1">
                    <div className="flex items-center">
                      <Avatar className="mr-2 -ml-1 size-5">
                        <AvatarImage src={member.picture} alt={member.name} />
                        <AvatarFallback>{member.name.charAt(0).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span>{member.name}</span>
                    </div>
                    <Checkbox
                      checked={internalSelectedMembers.includes(
                        useUserIds ? member.userId : member.id
                      )}
                      onCheckedChange={() => toggleMember(useUserIds ? member.userId : member.id)}
                      aria-label={`Select ${member.name}`}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {isLoading && (
              <div className="py-6 text-center text-sm text-muted-foreground">Loading...</div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
