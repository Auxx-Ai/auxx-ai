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
import { isCustomResource, type ResourcePickerItem } from '@auxx/lib/resources/client'
import { useRelationship, useResource, useResourceProvider } from '~/components/resources'
import { api } from '~/trpc/react'
import type { ResourceRef } from '@auxx/types/resource'

/**
 * Props for ResourcePickerItem display component
 */
interface ResourceItemProps {
  item: ResourcePickerItem
  isSelected: boolean
  onToggle: (ref: ResourceRef) => void
  showEntityType?: boolean
}

/**
 * Single item in the resource picker list.
 * Displays avatar or entity icon with name and secondary info.
 */
function ResourceItem({ item, isSelected, onToggle, showEntityType }: ResourceItemProps) {
  const { resource } = useResource(item.entityDefinitionId)
  const iconColor = resource && isCustomResource(resource) ? resource.color : undefined

  const handleSelect = () => {
    onToggle({
      entityDefinitionId: item.entityDefinitionId,
      entityInstanceId: item.id,
    })
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
  /** Currently selected resource references */
  value: ResourceRef[]

  /** Called when selection changes */
  onChange: (selected: ResourceRef[]) => void

  /** Single entity type to search */
  entityDefinitionId?: string

  /** Multiple entity types to search (takes precedence if both provided) */
  entityDefinitionIds?: string[]

  /** Multi-select mode (default: true) */
  multi?: boolean

  /** Called after selection in single-select mode */
  onSelectSingle?: (ref: ResourceRef) => void

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
}

/**
 * ResourcePicker - A context-agnostic resource picker component.
 * Supports searching entities and selecting ResourceRef values.
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
}: ResourcePickerProps) {
  const [search, setSearch] = useState('')
  const { getResourceById } = useResourceProvider()

  // Notify parent about capture state on mount/unmount
  useEffect(() => {
    onCaptureChange?.(true)
    return () => onCaptureChange?.(false)
  }, [onCaptureChange])

  // Track initial selected refs (snapshot at mount) - prevents layout shifts
  const [initialSelectedRefs, setInitialSelectedRefs] = useState<ResourceRef[]>(() => value)

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
  const { data: searchResults, isLoading: isSearching } = api.resource.search.useQuery(
    searchParams,
    {
      enabled: true,
      staleTime: 30_000,
    }
  )

  // Hydrate selected items
  const { items: hydratedItems, isLoading: isHydrating } = useRelationship(initialSelectedRefs)

  // Build map of hydrated items for quick lookup
  const hydratedMap = useMemo(() => {
    const map: Record<string, ResourcePickerItem> = {}
    initialSelectedRefs.forEach((ref, idx) => {
      const item = hydratedItems[idx]
      if (item) {
        const key = `${ref.entityDefinitionId}:${ref.entityInstanceId}`
        map[key] = item
      }
    })
    return map
  }, [initialSelectedRefs, hydratedItems])

  // Check if a ref is currently selected
  const isSelected = useCallback(
    (ref: ResourceRef) => {
      return value.some(
        (v) =>
          v.entityDefinitionId === ref.entityDefinitionId &&
          v.entityInstanceId === ref.entityInstanceId
      )
    },
    [value]
  )

  // Check if a ref was initially selected (for layout stability)
  const wasInitiallySelected = useCallback(
    (ref: ResourceRef) => {
      return initialSelectedRefs.some(
        (v) =>
          v.entityDefinitionId === ref.entityDefinitionId &&
          v.entityInstanceId === ref.entityInstanceId
      )
    },
    [initialSelectedRefs]
  )

  // Filter initially selected items by search term
  const filteredSelectedItems = useMemo(() => {
    const searchLower = search.toLowerCase()
    const items: ResourcePickerItem[] = []

    for (const ref of initialSelectedRefs) {
      const key = `${ref.entityDefinitionId}:${ref.entityInstanceId}`
      const item = hydratedMap[key]
      if (item) {
        // Apply search filter
        if (!search || item.displayName?.toLowerCase().includes(searchLower)) {
          items.push(item)
        }
      }
    }

    return items
  }, [initialSelectedRefs, hydratedMap, search])

  // Available items (from search, excluding initially selected)
  const availableItems = useMemo(() => {
    if (!searchResults?.items) return []
    return searchResults.items.filter((item) => {
      return !wasInitiallySelected({
        entityDefinitionId: item.entityDefinitionId,
        entityInstanceId: item.id,
      })
    })
  }, [searchResults, wasInitiallySelected])

  /**
   * Toggle selection of a resource
   */
  const handleToggle = useCallback(
    (ref: ResourceRef) => {
      if (multi) {
        // Toggle in array
        const exists = isSelected(ref)
        let newValue: ResourceRef[]

        if (exists) {
          newValue = value.filter(
            (v) =>
              !(
                v.entityDefinitionId === ref.entityDefinitionId &&
                v.entityInstanceId === ref.entityInstanceId
              )
          )
        } else {
          newValue = [...value, ref]
        }

        onChange(newValue)
      } else {
        // Single select - replace or deselect if same
        const exists = isSelected(ref)

        if (exists) {
          onChange([])
        } else {
          onChange([ref])
          onSelectSingle?.(ref)
        }
      }
    },
    [multi, value, onChange, isSelected, onSelectSingle]
  )

  // Sync initial selected refs when value changes from parent
  useEffect(() => {
    setInitialSelectedRefs(value)
  }, [value])

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
        {isLoading || isHydrating ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : (
          <>
            <CommandEmpty>No results found</CommandEmpty>

            {/* Selected Items Section */}
            {hasSelectedSection && (
              <CommandGroup aria-label="Selected Items">
                {filteredSelectedItems.map((item) => (
                  <ResourceItem
                    key={`${item.entityDefinitionId}:${item.id}`}
                    item={item}
                    isSelected={isSelected({
                      entityDefinitionId: item.entityDefinitionId,
                      entityInstanceId: item.id,
                    })}
                    onToggle={handleToggle}
                    showEntityType={showEntityType}
                  />
                ))}
              </CommandGroup>
            )}

            {/* Separator between sections */}
            {hasSelectedSection && hasResultsSection && <CommandSeparator />}

            {/* Available Items Section */}
            {hasResultsSection && (
              <CommandGroup aria-label="Available Items">
                {availableItems.map((item) => (
                  <ResourceItem
                    key={`${item.entityDefinitionId}:${item.id}`}
                    item={item}
                    isSelected={isSelected({
                      entityDefinitionId: item.entityDefinitionId,
                      entityInstanceId: item.id,
                    })}
                    onToggle={handleToggle}
                    showEntityType={showEntityType}
                  />
                ))}
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
