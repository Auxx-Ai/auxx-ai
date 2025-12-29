// src/components/mail/email-editor/inbox-selector.tsx
'use client'
import React, { useState } from 'react'
import { Badge } from '@auxx/ui/components/badge'
import { api } from '~/trpc/react'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'

interface IntegrationSelectorProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

const IntegrationSelector: React.FC<IntegrationSelectorProps> = ({ value, onChange, disabled }) => {
  // const { data: inboxes, isLoading } = api.inbox.getUserInboxes.useQuery()

  const { data: integrations, isLoading } = api.integration.getEmailClients.useQuery()

  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  React.useEffect(() => {
    if (integrations && integrations.length > 0 && !value) {
      onChange(integrations[0].id)
    }
  }, [integrations, value, onChange])

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm text-muted-foreground">Loading integrations...</span>
      </div>
    )
  }

  if (!integrations || integrations.length === 0) {
    return <div className="text-sm text-muted-foreground">No integrations available</div>
  }

  // Find the currently selected integration
  const selectedIntegration = integrations.find((integration) => integration.id === value)
  const displayName = selectedIntegration
    ? selectedIntegration?.email || selectedIntegration.name
    : 'Select Integration'

  return (
    <Popover
      open={open}
      onOpenChange={(newOpen) => {
        if (disabled) return
        setOpen(newOpen)
        if (!newOpen) {
          // Reset search when closing
          setSearchQuery('')
        }
      }}>
      <PopoverTrigger asChild disabled={disabled}>
        <div className="inline-block">
          <Badge
            variant="user"
            className={`${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
            role="combobox"
            aria-expanded={open}
            aria-label="Select inbox"
            onClick={(e) => {
              if (disabled) return
              e.preventDefault()
              setOpen(!open)
            }}>
            {displayName}
            <ChevronsUpDown
              className={`ml-1 h-3 w-3 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </Badge>
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-auto min-w-[200px] p-0">
        <Command
          filter={(value, search) => {
            // This is needed because the default filter doesn't work well with our custom CommandItem setup
            return true
          }}>
          <CommandInput
            placeholder="Search inboxes..."
            className="h-9"
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            <CommandEmpty>No inboxes found.</CommandEmpty>
            <CommandGroup>
              {integrations
                .filter((integration) => {
                  const integrationDisplay = integration?.email || integration.name
                  return integrationDisplay.toLowerCase().includes(searchQuery.toLowerCase())
                })
                .map((integration) => {
                  const integrationDisplay = integration?.email || integration.name

                  return (
                    <CommandItem
                      key={integration.id}
                      value={integration.id}
                      onSelect={(currentValue) => {
                        // We're using the integration ID directly as the value
                        onChange(integration.id)
                        setOpen(false)
                        setSearchQuery('')
                      }}>
                      <div className="flex items-center gap-2">
                        <div className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium">
                          {integrationDisplay?.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium">{integrationDisplay}</span>
                      </div>
                      <Check
                        className={`ml-auto ${value === integration.id ? 'opacity-100' : 'opacity-0'}`}
                        aria-hidden="true"
                      />
                    </CommandItem>
                  )
                })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export default IntegrationSelector
