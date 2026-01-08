// apps/web/src/components/shared/multi-relation-input.tsx

'use client'

import { useState, useMemo, useCallback } from 'react'
import { api } from '~/trpc/react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Button } from '@auxx/ui/components/button'
import { ChevronDown, Loader2, Check } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { Badge } from '@auxx/ui/components/badge'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useRelationship } from '~/components/resources'

/**
 * Relationship config shape from field.options?.relationship
 */
export interface RelationshipConfigProp {
  relatedEntityDefinitionId?: string
  relatedModelType?: string
  relationshipType?: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
}

/**
 * Props for MultiRelationInput
 */
export interface MultiRelationInputProps {
  /** Relationship config from field.options?.relationship - preferred way to configure */
  relationship?: RelationshipConfigProp

  /** Resource ID for the target table (system ID or custom entity UUID) */
  resourceId?: string

  /** Table ID for system resources or custom entity UUID */
  tableId?: string

  /** Currently selected IDs */
  value: string[]

  /** Callback when selection changes */
  onChange: (ids: string[]) => void

  /** Whether the input is disabled */
  disabled?: boolean

  /** Placeholder text when nothing selected */
  placeholder?: string

  /** Additional CSS classes */
  className?: string

  /** Maximum items to show in the trigger before collapsing */
  maxDisplayItems?: number

  /** Allow multiple selections - if not provided, inferred from relationship.relationshipType */
  multi?: boolean

  /** IDs to exclude from search results */
  excludeIds?: string[]
}

/**
 * MultiRelationInput - Multi-select picker for relationship fields
 *
 * Uses the relationship store for caching hydrated items.
 * Supports selecting multiple related records with checkbox-style toggling.
 */
export function MultiRelationInput({
  relationship,
  resourceId,
  tableId: tableIdProp,
  value = [],
  onChange,
  disabled = false,
  placeholder = 'Select items...',
  className,
  maxDisplayItems = 3,
  multi: multiProp,
  excludeIds = [],
}: MultiRelationInputProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Derive tableId from relationship config or legacy props
  const tableId = useMemo(() => {
    if (relationship) {
      return relationship.relatedEntityDefinitionId ?? relationship.relatedModelType ?? null
    }
    return tableIdProp ?? resourceId ?? null
  }, [relationship, tableIdProp, resourceId])

  // Derive multi from relationship config or explicit prop
  const multi = useMemo(() => {
    if (multiProp !== undefined) return multiProp
    if (relationship?.relationshipType) {
      return (
        relationship.relationshipType === 'has_many' ||
        relationship.relationshipType === 'many_to_many'
      )
    }
    return true // default to multi
  }, [multiProp, relationship?.relationshipType])

  // Get hydrated items for selected IDs from the store (tableId is system ID or UUID, no prefix needed)
  const { items: selectedItems, isLoading: isLoadingSelected } = useRelationship(
    tableId,
    value
  )

  // Search for items when popover is open
  const { data: searchResults, isLoading: isSearching } = api.resource.search.useQuery(
    {
      tableId: tableId!,
      search: searchQuery,
      limit: 20,
    },
    {
      enabled: open && !!tableId,
    }
  )

  // Filter out excluded IDs from search results
  const filteredItems = useMemo(
    () => (searchResults?.items || []).filter((item) => !excludeIds.includes(item.id)),
    [searchResults, excludeIds]
  )

  /**
   * Handle item selection
   * Multi mode: toggle selection
   * Single mode: select and close
   */
  const handleSelect = useCallback(
    (id: string) => {
      if (multi) {
        // Multi mode: toggle
        const isCurrentlySelected = value.includes(id)
        if (isCurrentlySelected) {
          onChange(value.filter((v) => v !== id))
        } else {
          onChange([...value, id])
        }
      } else {
        // Single mode: select and close
        onChange([id])
        setOpen(false)
        setSearchQuery('')
      }
    },
    [multi, value, onChange]
  )

  /**
   * Check if an item is selected
   */
  const isSelected = useCallback((id: string) => value.includes(id), [value])

  /**
   * Render the trigger content showing selected items
   */
  const renderTriggerContent = () => {
    if (value.length === 0) {
      return (
        <span className="text-primary-400 text-sm font-normal pointer-events-none">
          {placeholder}
        </span>
      )
    }

    if (isLoadingSelected) {
      return (
        <div className="flex gap-1 flex-1">
          {value.slice(0, maxDisplayItems).map((_, i) => (
            <Skeleton key={i} className="h-[15.5px] w-24 rounded-full" />
          ))}
        </div>
      )
    }

    const displayItems = selectedItems.slice(0, maxDisplayItems)
    const remainingCount = value.length - maxDisplayItems

    return (
      <div className="flex flex-wrap gap-1 flex-1 py-0.5">
        {displayItems.map((item, i) => (
          <Badge key={item?.id ?? i} variant="outline" className="text-xs">
            <div className="truncate">{item?.displayName ?? value[i]?.slice(-6) ?? '?'}</div>
          </Badge>
        ))}
        {remainingCount > 0 && (
          <Badge variant="outline" className="text-xs">
            +{remainingCount}
          </Badge>
        )}
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="transparent"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full ps-0 pe-1 h-auto min-h-8 justify-between flex-1', className)}>
          <div className="flex items-center gap-2 flex-1 min-w-0">{renderTriggerContent()}</div>
          <ChevronDown className="opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 min-w-[max(var(--radix-popover-trigger-width),18rem)]"
        align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search..."
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            {isSearching ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="size-4 animate-spin" />
              </div>
            ) : (
              <>
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup>
                  {filteredItems.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      onSelect={() => handleSelect(item.id)}
                      className="flex items-center gap-2 cursor-pointer">
                      {/* Single mode: show check icon on left when selected */}
                      {!multi && (
                        <Check
                          className={cn(
                            'h-4 w-4 shrink-0',
                            isSelected(item.id) ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                      )}
                      <div className="flex flex-col flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{item.displayName}</div>
                        {item.secondaryInfo && (
                          <div className="text-xs text-muted-foreground truncate">
                            {item.secondaryInfo}
                          </div>
                        )}
                      </div>
                      {/* Multi mode: show checkbox on right */}
                      {multi && (
                        <div
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
                            isSelected(item.id)
                              ? 'bg-primary-400 border-primary-400 text-primary-foreground'
                              : 'border-muted-foreground/30'
                          )}>
                          {isSelected(item.id) && <Check className="h-3 w-3" />}
                        </div>
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
