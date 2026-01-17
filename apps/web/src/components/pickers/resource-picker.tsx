// apps/web/src/components/pickers/resource-picker.tsx

'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { Check, Plus, Loader2 } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandGroup,
} from '@auxx/ui/components/command'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { cn } from '@auxx/ui/lib/utils'
import { EntityIcon } from '@auxx/ui/components/icons'
import {
  isCustomResource,
  toResourceId,
  getDefinitionId,
  type ResourcePickerItem,
  type ResourceId,
} from '@auxx/lib/resources/client'
import { useRelationship, useResource, useResourceStore } from '~/components/resources'
import { api } from '~/trpc/react'

/**
 * Props for ResourcePickerItem display component
 */
interface ResourceItemProps {
  item: ResourcePickerItem
  isSelected: boolean
  onToggle: (resourceId: ResourceId) => void
  showEntityType?: boolean
}

/**
 * Single item in the resource picker list.
 * Displays avatar or entity icon with name and secondary info.
 */
function ResourceItem({ item, isSelected, onToggle, showEntityType }: ResourceItemProps) {
  const { resource } = useResource(getDefinitionId(item.resourceId))
  const iconColor = resource && isCustomResource(resource) ? resource.color : undefined

  const handleSelect = () => {
    onToggle(item.resourceId)
  }

  return (
    <CommandItem
      key={item.id}
      value={item.id}
      onSelect={handleSelect}
      className="flex items-center gap-2">
      {item.avatarUrl ? (
        <Avatar className="size-5">
          <AvatarImage src={item.avatarUrl} />
          <AvatarFallback>{item.displayName?.[0]}</AvatarFallback>
        </Avatar>
      ) : (
        <EntityIcon
          iconId={resource?.icon ?? 'circle'}
          color={iconColor ?? 'gray'}
          size="sm"
          inverse
          className="-ms-0.5 inset-shadow-xs inset-shadow-black/20"
        />
      )}
      <div className="flex flex-1 items-center gap-1 flex-row">
        <span className="truncate">{item.displayName}</span>
        {item.secondaryInfo && (
          <span className="text-xs text-muted-foreground">{item.secondaryInfo}</span>
        )}
        {showEntityType && resource && (
          <span className="text-xs text-muted-foreground ml-auto">{resource.label}</span>
        )}
      </div>
      <Check className={cn('size-4', isSelected ? 'opacity-100' : 'opacity-0')} />
    </CommandItem>
  )
}

/**
 * Props for the ResourcePicker component
 */
export interface ResourcePickerProps {
  /** Currently selected ResourceIds */
  value: ResourceId[]

  /** Called when selection changes */
  onChange: (selected: ResourceId[]) => void

  /** Single entity type to search */
  entityDefinitionId?: string

  /** Multiple entity types to search (takes precedence if both provided) */
  entityDefinitionIds?: string[]

  /** Multi-select mode (default: true) */
  multi?: boolean

  /** Called after selection in single-select mode */
  onSelectSingle?: (resourceId: ResourceId) => void

  /** Callback when arrow key capture state changes */
  onCaptureChange?: (capturing: boolean) => void

  /** Disabled state */
  disabled?: boolean

  /** Search placeholder */
  placeholder?: string

  /** Loading state */
  isLoading?: boolean

  /** Allow creating new items (requires entityDefinitionId to be set) */
  canCreate?: boolean

  /** Callback when "Create new" is clicked */
  onCreate?: () => void

  /** Label for create button */
  createLabel?: string

  /** Additional className */
  className?: string

  /** ResourceIds to exclude from results (filtered client-side) */
  excludeIds?: ResourceId[]
}

/**
 * ResourcePicker - A context-agnostic resource picker component.
 * Supports searching entities and selecting ResourceId values.
 *
 * Features:
 * - Search across single entity type, multiple entity types, or all entities
 * - Multi-select or single-select mode
 * - Shows selected items at top, available items below
 * - Hydrates selected items using useRelationship hook
 */
export function ResourcePicker({
  value,
  onChange,
  entityDefinitionId,
  entityDefinitionIds,
  multi = true,
  onSelectSingle,
  onCaptureChange,
  disabled = false,
  placeholder = 'Search...',
  isLoading: externalLoading = false,
  canCreate = false,
  onCreate,
  createLabel = 'Create new',
  className,
  excludeIds = [],
}: ResourcePickerProps) {
  const [search, setSearch] = useState('')
  const getResourceById = useResourceStore((s) => s.getResourceById)

  // Notify parent about capture state on mount/unmount
  useEffect(() => {
    onCaptureChange?.(true)
    return () => onCaptureChange?.(false)
  }, [onCaptureChange])

  // Track initial selected resourceIds (snapshot at mount) - prevents layout shifts
  const [initialSelectedIds, setInitialSelectedIds] = useState<ResourceId[]>(() => value)

  // Determine search mode
  const isGlobalSearch = !entityDefinitionId && !entityDefinitionIds
  const isMultiEntitySearch = !!entityDefinitionIds && entityDefinitionIds.length > 0

  // Build search query params
  const searchParams = useMemo(() => {
    if (entityDefinitionIds && entityDefinitionIds.length > 0) {
      // Multi-entity search mode - use global search with filter
      return {
        query: search,
        entityDefinitionIds,
        limit: 20,
      }
    }
    if (entityDefinitionId) {
      // Single entity search mode
      return {
        entityDefinitionId,
        query: search,
        limit: 20,
      }
    }
    // Global search mode
    return {
      query: search,
      limit: 20,
    }
  }, [entityDefinitionId, entityDefinitionIds, search])

  // Search query
  const { data: searchResults, isLoading: isSearching } = api.record.search.useQuery(
    searchParams,
    {
      enabled: true,
      staleTime: 30_000,
    }
  )

  // Hydrate selected items
  const { items: hydratedItems, isLoading: isHydrating } = useRelationship(initialSelectedIds)

  // Build map of hydrated items for quick lookup
  const hydratedMap = useMemo(() => {
    const map: Record<string, ResourcePickerItem> = {}
    initialSelectedIds.forEach((resourceId, idx) => {
      const item = hydratedItems[idx]
      if (item) {
        map[resourceId] = item
      }
    })
    return map
  }, [initialSelectedIds, hydratedItems])

  // Check if a resourceId is currently selected
  const isSelected = useCallback(
    (resourceId: ResourceId) => {
      return value.includes(resourceId)
    },
    [value]
  )

  // Check if a resourceId was initially selected (for layout stability)
  const wasInitiallySelected = useCallback(
    (resourceId: ResourceId) => {
      return initialSelectedIds.includes(resourceId)
    },
    [initialSelectedIds]
  )

  // Filter initially selected items by search term
  const filteredSelectedItems = useMemo(() => {
    const searchLower = search.toLowerCase()
    const items: ResourcePickerItem[] = []

    for (const resourceId of initialSelectedIds) {
      const item = hydratedMap[resourceId]
      if (item) {
        // Apply search filter
        if (!search || item.displayName?.toLowerCase().includes(searchLower)) {
          items.push(item)
        }
      }
    }

    return items
  }, [initialSelectedIds, hydratedMap, search])

  // Available items (from search, excluding initially selected and excluded IDs)
  const availableItems = useMemo(() => {
    if (!searchResults?.items) return []
    return searchResults.items.filter((item) => {
      return !wasInitiallySelected(item.resourceId) && !excludeIds.includes(item.resourceId)
    })
  }, [searchResults, wasInitiallySelected, excludeIds])

  /**
   * Toggle selection of a resource
   */
  const handleToggle = useCallback(
    (resourceId: ResourceId) => {
      if (multi) {
        // Toggle in array
        const exists = isSelected(resourceId)
        let newValue: ResourceId[]

        if (exists) {
          newValue = value.filter((v) => v !== resourceId)
        } else {
          newValue = [...value, resourceId]
        }

        onChange(newValue)
      } else {
        // Single select - replace or deselect if same
        const exists = isSelected(resourceId)

        if (exists) {
          onChange([])
        } else {
          onChange([resourceId])
          onSelectSingle?.(resourceId)
        }
      }
    },
    [multi, value, onChange, isSelected, onSelectSingle]
  )

  // Get related resource for create label
  const relatedResource = useMemo(() => {
    if (!entityDefinitionId) return null
    return getResourceById(entityDefinitionId)
  }, [entityDefinitionId, getResourceById])

  const isLoading = externalLoading || isSearching
  const hasSelectedSection = filteredSelectedItems.length > 0
  const hasResultsSection = availableItems.length > 0
  const showEntityType = isGlobalSearch || isMultiEntitySearch

  return (
    <Command shouldFilter={false} className={cn('rounded-lg', className)}>
      <CommandInput
        placeholder={placeholder}
        value={search}
        onValueChange={setSearch}
        disabled={disabled}
      />
      <CommandList>
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : (
          <>
            <CommandEmpty>No results found</CommandEmpty>

            {/* Selected Items Section */}
            {hasSelectedSection && (
              <CommandGroup aria-label="Selected Items">
                {filteredSelectedItems.map((item) => {
                  return (
                    <ResourceItem
                      key={item.resourceId}
                      item={item}
                      isSelected={isSelected(item.resourceId)}
                      onToggle={handleToggle}
                      showEntityType={showEntityType}
                    />
                  )
                })}
              </CommandGroup>
            )}

            {/* Separator between sections */}
            {hasSelectedSection && hasResultsSection && <CommandSeparator />}

            {/* Available Items Section */}
            {hasResultsSection && (
              <CommandGroup aria-label="Available Items">
                {availableItems.map((item) => {
                  return (
                    <ResourceItem
                      key={item.resourceId}
                      item={item}
                      isSelected={isSelected(item.resourceId)}
                      onToggle={handleToggle}
                      showEntityType={showEntityType}
                    />
                  )
                })}
              </CommandGroup>
            )}

            {/* Create Option */}
            {canCreate && onCreate && (
              <>
                {(hasSelectedSection || hasResultsSection) && <CommandSeparator />}
                <CommandGroup aria-label="Create">
                  <CommandItem onSelect={onCreate} disabled={disabled}>
                    <Plus />
                    {createLabel || `Create ${relatedResource?.label ?? 'Item'}`}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </>
        )}
      </CommandList>
    </Command>
  )
}
