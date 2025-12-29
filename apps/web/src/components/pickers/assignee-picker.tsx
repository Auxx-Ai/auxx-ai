// components/ui/assignee-picker.tsx
'use client'

import { useState, useEffect, ReactNode } from 'react'
import { Check, X, Users, Search } from 'lucide-react'
// import { useDebounce } from 'use-debounce'
import { api } from '~/trpc/react'

import { cn } from '@auxx/ui/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@auxx/ui/components/form'
import { type Control } from 'react-hook-form'
import { useDebounce } from '~/hooks/use-debounced-value'
import { useUser } from '~/hooks/use-user'

// Define interfaces for our component
export interface TeamMember {
  id: string
  name?: string | null
  email?: string | null
  image?: string | null
}

export interface AssigneePickerProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  selected?: string | TeamMember | string[] | TeamMember[] // Updated to accept all formats
  onChange?: (selected: TeamMember[]) => void
  allowMultiple?: boolean
  className?: string
  inboxes?: any[]
  members?: TeamMember[]
  placeholder?: string
  children?: ReactNode
  disabled?: boolean
  includeUnassigned?: boolean
  size?: 'xs' | 'sm' | 'lg' | 'default'
  align?: 'start' | 'center' | 'end' // Alignment for the popover
  side?: 'top' | 'right' | 'bottom' | 'left' // Side for the popover
  sideOffset?: number // Offset for the popover
  style?: React.CSSProperties // Style for the popover content
}

export function AssigneePicker({
  open,
  onOpenChange,
  selected,
  onChange,
  allowMultiple = false,
  className,
  inboxes,
  members: providedMembers,
  placeholder = 'Select assignee',
  children,
  disabled = false,
  includeUnassigned = true,
  size = 'default',
  align = 'start',
  side = 'bottom',
  sideOffset = 5,
  ...props
}: AssigneePickerProps) {
  // Internal state
  const [isOpen, setIsOpen] = useState(open || false)
  const [searchValue, setSearchValue] = useState('')
  const [debouncedSearchValue] = useDebounce(searchValue, 300)

  const { user } = useUser()

  // Fetch team members if not provided externally
  const { data: fetchedMembers, isLoading } = api.user.teamMembers.useQuery(undefined, {
    enabled: !providedMembers,
  })

  const teamMembers = providedMembers || fetchedMembers || []

  // Helper function to normalize the selected value into TeamMember[] format
  const normalizeSelected = (value: any): TeamMember[] => {
    if (!value) return []

    // If it's a string (single ID)
    if (typeof value === 'string') {
      const member = teamMembers.find((m) => m.id === value)
      return member ? [member] : [{ id: value }]
    }

    // If it's a TeamMember object
    if (typeof value === 'object' && !Array.isArray(value) && value !== null && 'id' in value) {
      return [value as TeamMember]
    }

    // If it's an array
    if (Array.isArray(value)) {
      // Empty array
      if (value.length === 0) return []

      // Array of strings (IDs)
      if (typeof value[0] === 'string') {
        return value.map((id) => {
          const member = teamMembers.find((m) => m.id === id)
          return member || { id }
        })
      }

      // Array of TeamMember objects
      if (typeof value[0] === 'object' && 'id' in value[0]) {
        return value as TeamMember[]
      }
    }

    return []
  }

  // Initialize with normalized selected value
  const [selectedMembers, setSelectedMembers] = useState<TeamMember[]>(() =>
    normalizeSelected(selected)
  )

  // Update selected members when the selected prop changes
  useEffect(() => {
    const normalizedValue = normalizeSelected(selected)

    // Compare IDs to determine if we need to update
    const currentIds = selectedMembers
      .map((m) => m.id)
      .sort()
      .join(',')
    const newIds = normalizedValue
      .map((m) => m.id)
      .sort()
      .join(',')

    if (currentIds !== newIds) {
      setSelectedMembers(normalizedValue)
    }
  }, [selected, teamMembers])

  // Handle open state changes
  useEffect(() => {
    if (open !== undefined && open !== isOpen) {
      setIsOpen(open)
    }
  }, [open, isOpen])

  // Handle selection changes
  const handleSelect = (member: TeamMember | null) => {
    let newSelected: TeamMember[]

    if (member === null) {
      // Handle unassigned selection
      newSelected = []
    } else if (allowMultiple) {
      // Check if member is already selected
      const isSelected = selectedMembers.some((m) => m.id === member.id)

      if (isSelected) {
        // Remove member if already selected
        newSelected = selectedMembers.filter((m) => m.id !== member.id)
      } else {
        // Add member to selection
        newSelected = [...selectedMembers, member]
      }
    } else {
      // Single selection mode
      newSelected = [member]
    }

    // Before updating state or calling onChange, verify there's an actual change
    const currentIds = selectedMembers
      .map((m) => m.id)
      .sort()
      .join(',')
    const newIds = newSelected
      .map((m) => m.id)
      .sort()
      .join(',')

    if (currentIds !== newIds) {
      // Update internal state
      setSelectedMembers(newSelected)

      // Call onChange callback if provided
      if (onChange) {
        onChange(newSelected)
      }
    }

    // Close popover if in single selection mode
    if (!allowMultiple) {
      setIsOpen(false)
      if (onOpenChange) {
        onOpenChange(false)
      }
    }
  }

  // Filter members based on search
  const filteredMembers = teamMembers.filter((member) => {
    if (!debouncedSearchValue) return true

    const searchTerms = debouncedSearchValue.toLowerCase().split(' ')
    const memberName = member.name?.toLowerCase() || ''
    const memberEmail = member.email?.toLowerCase() || ''

    return searchTerms.every((term) => memberName.includes(term) || memberEmail.includes(term))
  })

  // Determine which members are not selected
  const unselectedMembers = filteredMembers.filter((member) => {
    return !selectedMembers.some((m) => m.id === member.id)
  })

  // Handle popover state
  const handleOpenChange = (newOpen: boolean) => {
    setIsOpen(newOpen)
    if (onOpenChange) {
      onOpenChange(newOpen)
    }
  }

  // Render the initials for avatar fallback
  const getInitials = (name?: string | null): string => {
    if (!name) return '?'
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .substring(0, 2)
  }

  const getName = (member: TeamMember): string => {
    if (!member) return 'Unknown'
    let name = member.name || member.email || 'Unknown'
    if (member.id === user?.id) {
      name = `${name} (Me)`
    }
    return name
  }

  // Custom trigger or default button
  const triggerElement = children ? (
    children
  ) : (
    <Button
      variant="outline"
      role="combobox"
      size={size}
      aria-expanded={isOpen}
      disabled={disabled}
      className={cn('justify-between rounded-full h-7 px-1.5 shrink-0', className)}>
      {selectedMembers && selectedMembers.length > 0 ? (
        <div className="flex items-center gap-2">
          {selectedMembers.length === 1 ? (
            <>
              <Avatar className="size-6">
                <AvatarImage
                  src={selectedMembers[0].image || undefined}
                  alt={selectedMembers[0].name || 'Assignee'}
                />
                <AvatarFallback>{getInitials(selectedMembers[0].name)}</AvatarFallback>
              </Avatar>
              <span className="truncate pe-1.5">
                {selectedMembers[0].name || selectedMembers[0].email}
              </span>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Users className="size-4" />
              <span>{selectedMembers.length} assignees</span>
            </div>
          )}
        </div>
      ) : (
        <span className="text-primary-400">{placeholder}</span>
      )}
      {/* <ChevronsUpDown className='ml-2 size-4 shrink-0 opacity-50' /> */}
    </Button>
  )

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{triggerElement}</PopoverTrigger>
      <PopoverContent className="p-0" align={align} side={side} sideOffset={sideOffset} {...props}>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search team members..."
            value={searchValue}
            onValueChange={setSearchValue}
            className="h-9"
            icon={Search}
          />

          <CommandList>
            <CommandEmpty>No members found.</CommandEmpty>

            {/* Selected members group */}
            {((selectedMembers && selectedMembers.length > 0) || includeUnassigned) && (
              <CommandGroup heading="Selected">
                {includeUnassigned && (
                  <CommandItem
                    value="unassigned"
                    onSelect={() => handleSelect(null)}
                    className="flex items-center rounded-full ">
                    <div className="mr-2 flex size-6 items-center justify-center rounded-full border">
                      <X className="size-3" />
                    </div>
                    <span>Unassigned</span>
                    {selectedMembers.length === 0 && <Check className="ml-auto size-4" />}
                  </CommandItem>
                )}

                {selectedMembers &&
                  selectedMembers.length > 0 &&
                  selectedMembers.map((member) => (
                    <CommandItem
                      key={member.id}
                      value={`selected-${member.id}`}
                      onSelect={() => handleSelect(member)}
                      className="flex items-center">
                      <Avatar className="mr-2 size-6">
                        <AvatarImage src={member.image || undefined} alt={getName(member)} />
                        <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
                      </Avatar>
                      <span>{getName(member)}</span>
                      {allowMultiple ? (
                        <div className="ml-auto flex size-4 items-center justify-center rounded-sm border">
                          <Check className="size-3" />
                        </div>
                      ) : (
                        <Check className="ml-auto size-4" />
                      )}
                    </CommandItem>
                  ))}
              </CommandGroup>
            )}

            {/* Show unselected members if there are any */}
            {unselectedMembers.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="All members">
                  {unselectedMembers.map((member) => (
                    <CommandItem
                      key={member.id}
                      value={member.id}
                      onSelect={() => handleSelect(member)}
                      className="flex items-center px-1">
                      <Avatar className="mr-2 size-6">
                        <AvatarImage src={member.image || undefined} alt={getName(member)} />
                        <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
                      </Avatar>
                      <span>{getName(member)}</span>
                      {allowMultiple && (
                        <div className="ml-auto flex size-4 items-center justify-center rounded-sm border" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// Form-specific version of the AssigneePicker for use with react-hook-form
export interface FormAssigneePickerProps
  extends Omit<AssigneePickerProps, 'onChange' | 'selected'> {
  name: string
  control: Control<any>
  label?: string
  description?: string
}

export function FormAssigneePicker({
  name,
  control,
  label,
  description,
  ...props
}: FormAssigneePickerProps) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex flex-col">
          {label && <FormLabel>{label}</FormLabel>}
          <FormControl>
            <AssigneePicker {...props} selected={field.value || []} onChange={field.onChange} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
