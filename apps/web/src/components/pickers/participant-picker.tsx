// src/components/pickers/participant-picker.tsx
'use client'

import { useState, useEffect } from 'react'
import { Check, Search, User } from 'lucide-react'
import { api } from '~/trpc/react'
import { cn } from '@auxx/ui/lib/utils'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { useDebouncedValue } from '~/hooks/use-debounced-value'

export interface Participant {
  id: string
  identifier: string
  displayName: string
  identifierType: string
  contactId?: string | null
  contact?: {
    id: string
    firstName?: string | null
    lastName?: string | null
    email?: string | null
  } | null
}

export interface ParticipantPickerProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  selected?: string | string[] // identifiers
  onChange?: (selected: string[]) => void
  allowMultiple?: boolean
  className?: string
  placeholder?: string
  type?: 'from' | 'to' | 'cc' | 'any'
  disabled?: boolean
  size?: 'xs' | 'sm' | 'lg' | 'default'
  align?: 'start' | 'center' | 'end' // Alignment for the popover
  side?: 'top' | 'right' | 'bottom' | 'left' // Side for the popover
  sideOffset?: number // Offset for the popover
  style?: React.CSSProperties // Additional styles for the popover
}

export function ParticipantPicker({
  open,
  onOpenChange,
  selected,
  onChange,
  allowMultiple = false,
  className,
  placeholder = 'Select participant',
  type = 'any',
  disabled = false,
  size = 'default',
  ...props
}: ParticipantPickerProps) {
  const [isOpen, setIsOpen] = useState(open || false)
  const [searchValue, setSearchValue] = useState('')
  const [debouncedSearchValue] = useDebouncedValue(searchValue, 300)

  // Normalize selected to array
  const selectedIdentifiers = Array.isArray(selected) ? selected : selected ? [selected] : []

  // Fetch participants based on search
  const { data: participants = [], isLoading } = api.search.participants.useQuery(
    { query: debouncedSearchValue, type: type },
    { enabled: isOpen && debouncedSearchValue.length > 0 }
  )

  // Handle open state changes
  useEffect(() => {
    if (open !== undefined && open !== isOpen) {
      setIsOpen(open)
    }
  }, [open, isOpen])

  const handleSelect = (participant: Participant) => {
    let newSelected: string[]

    if (allowMultiple) {
      const isSelected = selectedIdentifiers.includes(participant.identifier)

      if (isSelected) {
        newSelected = selectedIdentifiers.filter((id) => id !== participant.identifier)
      } else {
        newSelected = [...selectedIdentifiers, participant.identifier]
      }
    } else {
      newSelected = [participant.identifier]
    }

    onChange?.(newSelected)

    if (!allowMultiple) {
      setIsOpen(false)
      onOpenChange?.(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    setIsOpen(newOpen)
    onOpenChange?.(newOpen)
  }

  // Get initials for avatar
  const getInitials = (name: string): string => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .substring(0, 2)
  }

  // Get selected participant details for display
  const getSelectedDisplay = () => {
    if (selectedIdentifiers.length === 0) return null

    if (selectedIdentifiers.length === 1) {
      // For single selection, try to find the participant in our data
      const selected = participants.find((p) => p.identifier === selectedIdentifiers[0])
      return selected?.displayName || selectedIdentifiers[0]
    }

    return `${selectedIdentifiers.length} participants`
  }

  const triggerElement = (
    <Button
      variant="input"
      role="combobox"
      size={size}
      aria-expanded={isOpen}
      disabled={disabled}
      className={cn('justify-between', className)}>
      {selectedIdentifiers.length > 0 ? (
        <span className="truncate">{getSelectedDisplay()}</span>
      ) : (
        <span className="text-muted-foreground">{placeholder}</span>
      )}
    </Button>
  )

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{triggerElement}</PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" {...props}>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by name or email..."
            value={searchValue}
            onValueChange={setSearchValue}
            className="h-9"
            icon={Search}
          />

          <CommandList>
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Searching...</div>
            ) : participants.length === 0 && searchValue ? (
              <CommandEmpty>No participants found.</CommandEmpty>
            ) : searchValue ? (
              <CommandGroup heading="Search Results">
                {participants.map((participant) => {
                  const isSelected = selectedIdentifiers.includes(participant.identifier)

                  return (
                    <CommandItem
                      key={participant.id}
                      value={participant.identifier}
                      onSelect={() => handleSelect(participant)}
                      className="flex items-center">
                      <Avatar className="mr-2 h-6 w-6">
                        <AvatarFallback>
                          {participant.displayName ? (
                            getInitials(participant.displayName)
                          ) : (
                            <User className="h-3 w-3" />
                          )}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{participant.displayName}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {participant.identifier}
                        </div>
                      </div>

                      {isSelected && <Check className="ml-2 h-4 w-4" />}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ) : (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Type to search participants
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
