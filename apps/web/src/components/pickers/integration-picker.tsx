// apps/web/src/components/pickers/integration-picker.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Check } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useChannelStore } from '~/components/channels/store/channel-store'
import { getIntegrationColor, getIntegrationIconClass } from '../mail/mail-status-config'

interface Integration {
  id: string
  name: string | null
  provider: string
  email: string | null
  enabled: boolean
}

interface IntegrationPickerProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  selected?: string[] // Array of selected integration IDs
  onChange?: (selectedIntegrations: string[]) => void
  allowMultiple?: boolean
  selectAll?: boolean // New prop for showing "Select all" option
  selectAllLabel?: string // Custom label for "Select all" option
  className?: string
  integrations?: Integration[] // Optional pre-fetched integrations
  children?: React.ReactNode // Custom trigger
  align?: 'start' | 'center' | 'end' // Alignment for the popover
  side?: 'top' | 'right' | 'bottom' | 'left' // Side for the popover
  sideOffset?: number // Offset for the popover
  /**
   * Passed through to the default trigger `<Button>` (variant/className/size/…)
   * when no custom `children` trigger is given. Lets callers match the shared
   * `w-full ps-0 pe-1` flush-in-a-`FieldPanelRow` sizing convention without
   * hand-rolling a trigger, see `docs/ui-design-guide.md` §5.
   */
  triggerProps?: React.ComponentProps<typeof Button>
}

export const INTEGRATION_SELECT_ALL_VALUE = '__all__'

export function IntegrationPicker({
  open,
  onOpenChange,
  selected = [],
  onChange,
  allowMultiple = false,
  selectAll = false,
  selectAllLabel = 'Select all',
  className,
  integrations: externalIntegrations,
  children,
  triggerProps,
  ...props
}: IntegrationPickerProps) {
  // Read channels from the hydrated store (kept opt-in via externalIntegrations
  // for callers that need a custom list, e.g. workflow contexts).
  const storeChannels = useChannelStore((s) => s.channels)
  const integrations = externalIntegrations || storeChannels

  // Fully controlled: `selected` is the single source of truth, like InboxPicker.
  // A local useState copy went stale whenever the caller changed the selection
  // from outside the picker (e.g. the inbox shortcut on the message trigger).
  const [searchValue, setSearchValue] = useState('')

  // Check if "Select all" is currently selected
  const isSelectAllChecked = selected.includes(INTEGRATION_SELECT_ALL_VALUE)

  // Handle integration selection
  const handleIntegrationSelect = (integrationId: string) => {
    let newSelected: string[]

    if (integrationId === INTEGRATION_SELECT_ALL_VALUE) {
      // Handle "Select all" selection
      if (isSelectAllChecked) {
        // Uncheck "Select all" - clear all selections
        newSelected = []
      } else {
        // Check "Select all" - only include the special value
        newSelected = [INTEGRATION_SELECT_ALL_VALUE]
      }
    } else {
      // Handle individual integration selection
      if (!allowMultiple) {
        // Single selection mode
        newSelected = [integrationId]
      } else {
        // Multiple selection mode
        if (isSelectAllChecked) {
          // If "Select all" was checked, uncheck it and select only this item
          newSelected = [integrationId]
        } else {
          // Normal multi-select behavior
          newSelected = selected.includes(integrationId)
            ? selected.filter((id) => id !== integrationId)
            : [...selected, integrationId]
        }
      }
    }

    if (!allowMultiple && integrationId !== INTEGRATION_SELECT_ALL_VALUE) {
      setSearchValue('')
      if (onOpenChange) {
        onOpenChange(false)
      }
    }
    onChange?.(newSelected)
  }

  // Filter integrations based on search
  const filteredIntegrations = integrations.filter((integration) => {
    const searchText =
      `${integration.name || ''} ${integration.provider} ${integration.email || ''}`.toLowerCase()
    return searchText.includes(searchValue.toLowerCase())
  })

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {children || (
          <Button variant='outline' {...triggerProps}>
            Select Integration{allowMultiple ? 's' : ''}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className={cn('w-[300px] p-0', className)} {...props}>
        <Command>
          <CommandInput
            placeholder='Search channels...'
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList>
            <CommandEmpty>No channels found.</CommandEmpty>
            {/* Select All option - only show when allowMultiple and selectAll are true */}
            {allowMultiple && selectAll && (
              <CommandGroup>
                <CommandItem
                  value={INTEGRATION_SELECT_ALL_VALUE}
                  onSelect={() => handleIntegrationSelect(INTEGRATION_SELECT_ALL_VALUE)}
                  className='flex items-center justify-between'>
                  <span className='font-medium'>{selectAllLabel}</span>
                  <Checkbox
                    checked={isSelectAllChecked}
                    onCheckedChange={() => handleIntegrationSelect(INTEGRATION_SELECT_ALL_VALUE)}
                  />
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup heading='All Channels'>
              {filteredIntegrations.map((integration) => {
                const Icon = getIntegrationIconClass(integration.provider)
                const color = getIntegrationColor(integration.provider)
                const displayName = integration.name || `${integration.provider} Integration`

                return (
                  <CommandItem
                    key={integration.id}
                    value={integration.id}
                    onSelect={() => handleIntegrationSelect(integration.id)}
                    className='flex items-center justify-between'>
                    <div className='flex items-center space-x-2'>
                      <div
                        className='flex h-6 w-6 items-center justify-center rounded'
                        style={{ backgroundColor: `${color}20` }}>
                        <Icon className='h-4 w-4' style={{ color }} />
                      </div>
                      <div className='flex flex-col'>
                        <span className='text-sm font-medium'>{displayName}</span>
                        {integration.email && (
                          <span className='text-xs text-muted-foreground'>{integration.email}</span>
                        )}
                      </div>
                    </div>
                    {allowMultiple ? (
                      <Checkbox
                        checked={!isSelectAllChecked && selected.includes(integration.id)}
                        onCheckedChange={() => handleIntegrationSelect(integration.id)}
                      />
                    ) : (
                      selected.includes(integration.id) && <Check className='ml-auto h-4 w-4' />
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {allowMultiple && selected.length > 0 && (
          <div className='flex flex-wrap gap-1 border-t p-2'>
            {isSelectAllChecked ? (
              <Badge variant='secondary' className='flex items-center'>
                All Channels Selected
              </Badge>
            ) : (
              selected
                .filter((id) => id !== INTEGRATION_SELECT_ALL_VALUE)
                .map((selectedId) => {
                  const selectedIntegration = integrations.find(
                    (integration) => integration.id === selectedId
                  )
                  if (!selectedIntegration) return null

                  const Icon = getIntegrationIconClass(selectedIntegration.provider)
                  const color = getIntegrationColor(selectedIntegration.provider)
                  const displayName =
                    selectedIntegration.name || `${selectedIntegration.provider} Integration`

                  return (
                    <Badge key={selectedId} variant='secondary' className='flex items-center'>
                      <div
                        className='mr-2 flex h-3 w-3 items-center justify-center rounded'
                        style={{ backgroundColor: `${color}20` }}>
                        <Icon className='h-2 w-2' style={{ color }} />
                      </div>
                      {displayName}
                    </Badge>
                  )
                })
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
