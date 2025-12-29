import { usePropertyContext } from '../drawer/property-provider'
import { useEffect, useState } from 'react'
import { api } from '~/trpc/react'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { X } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'

/**
 * ContactGroupsInputField
 * Editor for customer groups multi-select field
 */
export function ContactGroupsInputField() {
  const { value, setValue, onChange, isSaving } = usePropertyContext()
  const [selectedGroups, setSelectedGroups] = useState<any[]>(value || [])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')

  // Fetch available customer groups
  const { data: availableGroups = [] } = api.contact.getGroups.useQuery({ search: searchValue })

  useEffect(() => {
    setSelectedGroups(value || [])
  }, [value])

  const updateGroups = (newGroups: any[]) => {
    setSelectedGroups(newGroups)
    onChange(newGroups)
    setValue(newGroups)
  }

  const addGroup = (group: any) => {
    const isAlreadySelected = selectedGroups.some(
      (selected) => selected.id === group.id || selected.customerGroupId === group.id
    )

    if (!isAlreadySelected) {
      const newGroups = [...selectedGroups, group]
      updateGroups(newGroups)
    }
    setSearchOpen(false)
    setSearchValue('')
  }

  const removeGroup = (groupToRemove: any) => {
    const groupId = groupToRemove.id || groupToRemove.customerGroupId
    const newGroups = selectedGroups.filter(
      (group) => group.id !== groupId && group.customerGroupId !== groupId
    )
    updateGroups(newGroups)
  }

  const getGroupName = (group: any) => {
    return group.name || group.customerGroup?.name || 'Unknown Group'
  }

  const getGroupId = (group: any) => {
    return group.id || group.customerGroupId || group
  }

  return (
    <div className="p-3 space-y-3">
      <div className="space-y-2">
        <label className="text-sm font-medium">Customer Groups</label>

        {/* Selected Groups */}
        <div className="flex flex-wrap gap-2 min-h-[32px] p-2 border rounded-md">
          {selectedGroups.length > 0 ? (
            selectedGroups.map((group) => (
              <Badge key={getGroupId(group)} variant="secondary" className="text-xs">
                {getGroupName(group)}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 ml-1 hover:bg-destructive hover:text-destructive-foreground"
                  onClick={() => removeGroup(group)}
                  disabled={isSaving}>
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">No groups selected</span>
          )}
        </div>

        {/* Add Group Button */}
        <Popover open={searchOpen} onOpenChange={setSearchOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" disabled={isSaving}>
              Add Group
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0" align="start">
            <Command>
              <CommandInput
                placeholder="Search groups..."
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandEmpty>No groups found.</CommandEmpty>
              <CommandGroup className="max-h-[200px] overflow-auto">
                {availableGroups.map((group) => {
                  const isSelected = selectedGroups.some(
                    (selected) => selected.id === group.id || selected.customerGroupId === group.id
                  )

                  return (
                    <CommandItem
                      key={group.id}
                      onSelect={() => addGroup(group)}
                      disabled={isSelected}
                      className={isSelected ? 'opacity-50' : ''}>
                      {group.name}
                      {isSelected && (
                        <span className="ml-auto text-xs text-muted-foreground">Selected</span>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
