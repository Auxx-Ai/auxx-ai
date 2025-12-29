'use client'

import React, { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { useInbox } from '~/hooks/use-inbox'
import { cn } from '@auxx/ui/lib/utils'
import { Check } from 'lucide-react'
import { type InboxWithRelations } from '@auxx/lib/types'

interface InboxPickerProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  selected?: string[] // Array of selected inbox IDs
  onChange?: (selectedInboxes: string[]) => void
  allowMultiple?: boolean
  selectAll?: boolean // New prop for showing "Select all" option
  selectAllLabel?: string // Custom label for "Select all" option
  className?: string
  inboxes?: InboxWithRelations[] // Optional pre-fetched inboxes
  children?: React.ReactNode // Custom trigger
  align?: 'start' | 'center' | 'end' // Alignment for the popover
  side?: 'top' | 'right' | 'bottom' | 'left' // Side for the popover
  sideOffset?: number // Offset for the popover
  style?: React.CSSProperties // Additional styles for the popover
}

export const INBOX_SELECT_ALL_VALUE = '__all__'

export function InboxPicker({
  open,
  onOpenChange,
  selected = [],
  onChange,
  allowMultiple = false,
  selectAll = false,
  selectAllLabel = 'Select all',
  className,
  inboxes: externalInboxes,
  children,
  ...props
}: InboxPickerProps) {
  // Use the custom hook to fetch inboxes if not provided
  const { inboxes: fetchedInboxes } = useInbox()
  const inboxes = externalInboxes || fetchedInboxes || []

  // Local state for managing selected inboxes
  const [localSelected, setLocalSelected] = useState<string[]>(selected)
  const [searchValue, setSearchValue] = useState('')

  // Check if "Select all" is currently selected
  const isSelectAllChecked = localSelected.includes(INBOX_SELECT_ALL_VALUE)

  // Handle inbox selection
  const handleInboxSelect = (inboxId: string) => {
    let newSelected: string[]

    if (inboxId === INBOX_SELECT_ALL_VALUE) {
      // Handle "Select all" selection
      if (isSelectAllChecked) {
        // Uncheck "Select all" - clear all selections
        newSelected = []
      } else {
        // Check "Select all" - only include the special value
        newSelected = [INBOX_SELECT_ALL_VALUE]
      }
    } else {
      // Handle individual inbox selection
      if (!allowMultiple) {
        // Single selection mode
        newSelected = [inboxId]
      } else {
        // Multiple selection mode
        if (isSelectAllChecked) {
          // If "Select all" was checked, uncheck it and select only this item
          newSelected = [inboxId]
        } else {
          // Normal multi-select behavior
          newSelected = localSelected.includes(inboxId)
            ? localSelected.filter((id) => id !== inboxId)
            : [...localSelected, inboxId]
        }
      }
    }

    if (!allowMultiple && inboxId !== INBOX_SELECT_ALL_VALUE) {
      setSearchValue('')
      if (onOpenChange) {
        onOpenChange(false)
      }
    }
    setLocalSelected(newSelected)
    onChange?.(newSelected)
  }

  // Filter inboxes based on search
  const filteredInboxes = inboxes.filter((inbox) =>
    inbox.name.toLowerCase().includes(searchValue.toLowerCase())
  )

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {children || <Button variant="outline">Select Inbox{allowMultiple ? 's' : ''}</Button>}
      </PopoverTrigger>
      <PopoverContent
        className={cn('w-[300px] p-0 backdrop-blur-sm bg-popover/60', className)}
        {...props}>
        <Command>
          <CommandInput
            placeholder="Search inboxes..."
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList>
            <CommandEmpty>No inboxes found.</CommandEmpty>
            {/* Select All option - only show when allowMultiple and selectAll are true */}
            {allowMultiple && selectAll && (
              <CommandGroup>
                <CommandItem
                  value={INBOX_SELECT_ALL_VALUE}
                  onSelect={() => handleInboxSelect(INBOX_SELECT_ALL_VALUE)}
                  className="flex items-center justify-between">
                  <span className="font-medium">{selectAllLabel}</span>
                  <Checkbox
                    checked={isSelectAllChecked}
                    onCheckedChange={() => handleInboxSelect(INBOX_SELECT_ALL_VALUE)}
                  />
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup heading="All Inboxes">
              {filteredInboxes.map((inbox) => (
                <CommandItem
                  key={inbox.id}
                  value={inbox.id}
                  onSelect={() => handleInboxSelect(inbox.id)}
                  className="flex items-center justify-between rounded-full">
                  <div className="flex items-center space-x-2">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: inbox.color || '#4F46E5' }}
                    />
                    <span>{inbox.name}</span>
                  </div>
                  {allowMultiple ? (
                    <Checkbox
                      checked={!isSelectAllChecked && localSelected.includes(inbox.id)}
                      onCheckedChange={() => handleInboxSelect(inbox.id)}
                    />
                  ) : (
                    localSelected.includes(inbox.id) && <Check className="ml-auto h-4 w-4" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {allowMultiple && localSelected.length > 0 && (
          <div className="flex flex-wrap gap-1 border-t p-2">
            {isSelectAllChecked ? (
              <Badge variant="secondary" className="flex items-center">
                All Inboxes Selected
              </Badge>
            ) : (
              localSelected.map((selectedId) => {
                const selectedInbox = inboxes.find((inbox) => inbox.id === selectedId)
                return selectedInbox ? (
                  <Badge key={selectedId} variant="secondary" className="flex items-center">
                    <div
                      className="mr-2 h-2 w-2 rounded-full"
                      style={{ backgroundColor: selectedInbox.color || '#4F46E5' }}
                    />
                    {selectedInbox.name}
                  </Badge>
                ) : null
              })
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
