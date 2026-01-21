// apps/web/src/components/groups/ui/group-picker.tsx
'use client'

import { useState } from 'react'
import { Check, ChevronsUpDown, PlusCircle } from 'lucide-react'
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
import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useGroups } from '../hooks'
import { getGroupMetadata } from '../utils'

/** Group option for display */
export type GroupOption = {
  id: string
  name: string
  emoji?: string
  color?: string
}

/** Props for GroupPicker component */
type GroupPickerProps = {
  /** Currently selected group IDs */
  selectedGroups: string[]
  /** Called when selection changes */
  onChange: (value: string[]) => void
  /** Placeholder text */
  placeholder?: string
  /** URL for create new group */
  createNewHref?: string
  /** Whether picker is disabled */
  disabled?: boolean
  /** Additional class names */
  className?: string
  /** Whether to hide create option */
  disableCreate?: boolean
}

/**
 * Multi-select group picker with badges
 * Fetches groups from the new entityGroup API
 */
export function GroupPicker({
  selectedGroups,
  onChange,
  placeholder = 'Select groups',
  createNewHref,
  disabled = false,
  className,
  disableCreate = false,
}: GroupPickerProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const { data: groups, isLoading } = useGroups()

  // Format groups for the picker
  const groupOptions: GroupOption[] = (groups ?? []).map((group) => {
    const metadata = getGroupMetadata(group)
    return {
      id: group.id,
      name: group.displayName || '',
      emoji: metadata.icon || '👥',
      color: metadata.color || '#4f46e5',
    }
  })

  /** Toggle selection of a group */
  const toggleGroup = (groupId: string) => {
    const newSelection = selectedGroups.includes(groupId)
      ? selectedGroups.filter((id) => id !== groupId)
      : [...selectedGroups, groupId]

    onChange(newSelection)
  }

  // Get selected group details for display
  const selectedGroupsDetails = groupOptions.filter((group) => selectedGroups.includes(group.id))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between', className)}
          disabled={disabled}>
          {selectedGroups.length > 0 ? (
            <div className="flex flex-wrap gap-1 overflow-hidden">
              {selectedGroupsDetails.map((group) => (
                <Badge key={group.id} style={{ backgroundColor: group.color }} className="mr-1 flex items-center">
                  <span className="mr-1">{group.emoji}</span>
                  {group.name}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full min-w-[300px] p-0">
        <Command>
          <CommandInput placeholder="Search groups..." value={searchQuery} onValueChange={setSearchQuery} />
          <CommandList>
            <CommandEmpty>{searchQuery ? 'No groups found.' : 'No groups available.'}</CommandEmpty>
            {isLoading ? (
              <div className="p-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="mt-2 h-8 w-full" />
                <Skeleton className="mt-2 h-8 w-full" />
              </div>
            ) : (
              <CommandGroup heading="Groups">
                {groupOptions.map((group) => {
                  const isSelected = selectedGroups.includes(group.id)

                  return (
                    <CommandItem
                      key={group.id}
                      value={group.name}
                      onSelect={() => toggleGroup(group.id)}
                      className="flex items-center">
                      <span className="mr-2">{group.emoji}</span>
                      <span>{group.name}</span>
                      <Check className={cn('ml-auto h-4 w-4', isSelected ? 'opacity-100' : 'opacity-0')} />
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}

            {!disableCreate && createNewHref && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      window.location.href = createNewHref
                    }}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Create Group
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Props for FormGroupPicker component */
type FormGroupPickerProps = Omit<GroupPickerProps, 'selectedGroups' | 'onChange'> & {
  /** Current value from form */
  value?: string[]
  /** Called on blur */
  onBlur?: () => void
  /** Field name */
  name?: string
  /** Called when value changes */
  onChange?: (value: string[]) => void
}

/**
 * Form-connected version for use with react-hook-form
 */
export function FormGroupPicker({ value = [], onChange, onBlur, name, ...props }: FormGroupPickerProps) {
  const handleChange = (newValue: string[]) => {
    onChange?.(newValue)
  }

  return <GroupPicker selectedGroups={value} onChange={handleChange} {...props} />
}
