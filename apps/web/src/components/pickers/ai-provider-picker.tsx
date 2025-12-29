// ~/components/pickers/ai-provider-picker.tsx
'use client'

import React, { useState, useMemo } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Button } from '@auxx/ui/components/button'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { ProviderIcon } from '~/components/ai/ui/provider-icon'
import type { ProviderConfiguration } from '~/components/ai/ui/utils'

interface AiProviderPickerProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** The selected provider key */
  value?: string | null
  /** Callback when a provider is selected */
  onChange?: (selectedProvider: string | null) => void
  className?: string
  /** Custom trigger element */
  children?: React.ReactNode
  /** Placeholder for the search input */
  placeholder?: string
  /** Text for the empty state */
  emptyText?: string
  /** Providers list passed from parent */
  providers: ProviderConfiguration[]
}

export function AiProviderPicker({
  value,
  onChange,
  className,
  children,
  placeholder = 'Search providers...',
  emptyText = 'No providers found.',
  providers,
}: AiProviderPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')

  // Use external state if provided, otherwise use internal state
  const isOpen = internalOpen
  const setIsOpen = setInternalOpen

  // Transform providers data for compatibility with the existing component structure
  const allProviders = useMemo(() => {
    return providers.map((provider) => ({
      id: provider.provider,
      displayName: provider.displayName,
      description: provider.description || '',
      icon: provider.icon,
      color: provider.color,
    }))
  }, [providers])

  // Filter providers based on search
  const searchFilteredProviders = useMemo(() => {
    if (!searchValue) return allProviders
    const lowerSearch = searchValue.toLowerCase()
    return allProviders.filter(
      (provider) =>
        provider.displayName.toLowerCase().includes(lowerSearch) ||
        provider.id.toLowerCase().includes(lowerSearch) ||
        provider.description?.toLowerCase().includes(lowerSearch)
    )
  }, [allProviders, searchValue])

  // Get selected provider
  const selectedProvider = useMemo(() => {
    if (!value) return null
    return allProviders.find((p) => p.id === value) || null
  }, [value, allProviders])

  const handleSelect = (providerKey: string) => {
    onChange?.(providerKey)
    setIsOpen(false)
    setSearchValue('')
  }

  const triggerLabel = selectedProvider ? selectedProvider.displayName : 'Select a provider'
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        {children || (
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={isOpen}
            className={cn(
              'w-[300px] justify-between px-1',
              !selectedProvider && 'text-muted-foreground'
            )}>
            <div className="flex items-center gap-2">
              {selectedProvider && (
                <ProviderIcon provider={selectedProvider} size="sm" className="shrink-0" />
              )}
              {triggerLabel}
            </div>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className={cn('p-0 w-[350px]', className)}>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList>
            {searchFilteredProviders.length === 0 && <CommandEmpty>{emptyText}</CommandEmpty>}
            {searchFilteredProviders.length > 0 && (
              <CommandGroup>
                {searchFilteredProviders.map((provider) => (
                  <CommandItem
                    key={provider.id}
                    value={provider.id}
                    onSelect={() => handleSelect(provider.id)}
                    className="cursor-pointer flex items-center justify-between">
                    <div className="flex flex-row items-center gap-2">
                      <ProviderIcon
                        provider={provider}
                        size="md"
                        className="shrink-0 rounded-full"
                      />
                      <div className="flex flex-col gap-0.5">
                        <p className="text-sm font-medium truncate line-clamp-1">
                          {provider.displayName}
                        </p>
                        {provider.description && (
                          <span
                            className="text-xs text-muted-foreground truncate line-clamp-1"
                            title={provider.description}>
                            {provider.description}
                          </span>
                        )}
                      </div>
                    </div>
                    <Check
                      className={cn('size-4', value === provider.id ? 'opacity-100' : 'opacity-0')}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
