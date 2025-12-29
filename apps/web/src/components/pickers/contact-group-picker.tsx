// apps/web/src/components/pickers/contact-group-picker.tsx

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
import { api } from '~/trpc/react'
import { cn } from '@auxx/ui/lib/utils'
import { Check, Users } from 'lucide-react'

interface ContactGroupPickerProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  selected?: string[] // Array of selected group IDs
  onChange?: (selectedGroups: string[]) => void
  allowMultiple?: boolean
  selectAll?: boolean // New prop for showing "Select all" option
  selectAllLabel?: string // Custom label for "Select all" option
  className?: string
  children?: React.ReactNode // Custom trigger
  align?: 'start' | 'center' | 'end' // Alignment for the popover
  side?: 'top' | 'right' | 'bottom' | 'left' // Side for the popover
  sideOffset?: number // Offset for the popover
}

export const CONTACT_GROUP_SELECT_ALL_VALUE = '__all__'

export function ContactGroupPicker({
  open,
  onOpenChange,
  selected = [],
  onChange,
  allowMultiple = false,
  selectAll = false,
  selectAllLabel = 'Select all',
  className,
  children,
  ...props
}: ContactGroupPickerProps) {
  // Fetch contact groups
  const { data: groups, isLoading } = api.rule.getContactGroupsForPicker.useQuery()

  // Local state for managing selected groups
  const [localSelected, setLocalSelected] = useState<string[]>(selected)
  const [searchValue, setSearchValue] = useState('')

  // Check if "Select all" is currently selected
  const isSelectAllChecked = localSelected.includes(CONTACT_GROUP_SELECT_ALL_VALUE)

  // Handle group selection
  const handleGroupSelect = (groupId: string) => {
    let newSelected: string[]

    if (groupId === CONTACT_GROUP_SELECT_ALL_VALUE) {
      // Handle "Select all" selection
      if (isSelectAllChecked) {
        // Uncheck "Select all" - clear all selections
        newSelected = []
      } else {
        // Check "Select all" - only include the special value
        newSelected = [CONTACT_GROUP_SELECT_ALL_VALUE]
      }
    } else {
      // Handle individual group selection
      if (!allowMultiple) {
        // Single selection mode
        newSelected = [groupId]
      } else {
        // Multiple selection mode
        if (isSelectAllChecked) {
          // If "Select all" was checked, uncheck it and select only this item
          newSelected = [groupId]
        } else {
          // Normal multi-select behavior
          newSelected = localSelected.includes(groupId)
            ? localSelected.filter((id) => id !== groupId)
            : [...localSelected, groupId]
        }
      }
    }

    if (!allowMultiple && groupId !== CONTACT_GROUP_SELECT_ALL_VALUE) {
      setSearchValue('')
      if (onOpenChange) {
        onOpenChange(false)
      }
    }
    setLocalSelected(newSelected)
    onChange?.(newSelected)
  }

  // Filter groups based on search
  const filteredGroups =
    groups?.filter((group) => group.name.toLowerCase().includes(searchValue.toLowerCase())) || []

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {children || (
          <Button variant="outline">Select Contact Group{allowMultiple ? 's' : ''}</Button>
        )}
      </PopoverTrigger>
      <PopoverContent className={cn('w-[350px] p-0', className)} {...props}>
        <Command>
          <CommandInput
            placeholder="Search contact groups..."
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList>
            {isLoading ? (
              <CommandEmpty>Loading contact groups...</CommandEmpty>
            ) : filteredGroups.length === 0 ? (
              <CommandEmpty>No contact groups found.</CommandEmpty>
            ) : (
              <>
                {/* Select All option - only show when allowMultiple and selectAll are true */}
                {allowMultiple && selectAll && (
                  <CommandGroup>
                    <CommandItem
                      value={CONTACT_GROUP_SELECT_ALL_VALUE}
                      onSelect={() => handleGroupSelect(CONTACT_GROUP_SELECT_ALL_VALUE)}
                      className="flex items-center justify-between">
                      <span className="font-medium">{selectAllLabel}</span>
                      <Checkbox
                        checked={isSelectAllChecked}
                        onCheckedChange={() => handleGroupSelect(CONTACT_GROUP_SELECT_ALL_VALUE)}
                      />
                    </CommandItem>
                  </CommandGroup>
                )}
                <CommandGroup heading="Contact Groups">
                  {filteredGroups.map((group) => (
                    <CommandItem
                      key={group.id}
                      value={group.id}
                      onSelect={() => handleGroupSelect(group.id)}
                      className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Users className="h-4 w-4 text-orange-600" />
                        <div className="flex-1">
                          <div className="font-medium">{group.name}</div>
                          {(group.description || group._count?.members) && (
                            <div className="text-xs text-muted-foreground">
                              {group.description || 'No description'}
                              {group._count?.members && (
                                <span className="ml-2">• {group._count.members} members</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {allowMultiple ? (
                        <Checkbox
                          checked={!isSelectAllChecked && localSelected.includes(group.id)}
                          onCheckedChange={() => handleGroupSelect(group.id)}
                        />
                      ) : (
                        localSelected.includes(group.id) && <Check className="ml-auto h-4 w-4" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
        {allowMultiple && localSelected.length > 0 && (
          <div className="flex flex-wrap gap-1 border-t p-2">
            {isSelectAllChecked ? (
              <Badge
                variant="secondary"
                className="flex items-center bg-orange-100 text-orange-700">
                <Users className="mr-1 h-3 w-3" />
                All Contact Groups Selected
              </Badge>
            ) : (
              localSelected.map((selectedId) => {
                const selectedGroup = groups?.find((group) => group.id === selectedId)
                return selectedGroup ? (
                  <Badge
                    key={selectedId}
                    variant="secondary"
                    className="flex items-center bg-orange-100 text-orange-700">
                    <Users className="mr-1 h-3 w-3" />
                    {selectedGroup.name}
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
