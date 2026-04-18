// apps/web/src/components/pickers/record-picker/record-picker-content.tsx

'use client'

import type { RecordId, RecordPickerItem } from '@auxx/lib/resources/client'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPlaceholder,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { cn } from '@auxx/ui/lib/utils'
import { keepPreviousData } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRelationship, useResourceStore } from '~/components/resources'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'
import { RecordItem } from './record-item'

/**
 * Props for the RecordPickerContent component
 */
export interface RecordPickerContentProps {
  /** Currently selected RecordIds */
  value: RecordId[]

  /** Called when selection changes */
  onChange: (selected: RecordId[]) => void

  /** Single entity type to search */
  entityDefinitionId?: string

  /** Multiple entity types to search (takes precedence if both provided) */
  entityDefinitionIds?: string[]

  /** Multi-select mode (default: true) */
  multi?: boolean

  /** Called after selection in single-select mode */
  onSelectSingle?: (recordId: RecordId) => void

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

  /** RecordIds to exclude from results (filtered client-side) */
  excludeIds?: RecordId[]

  /** Called with full item data on single-select (alternative to onSelectSingle) */
  onSelectItem?: (item: RecordPickerItem) => void

  /** External search value — hides internal CommandInput when provided */
  externalSearch?: string
}

/**
 * RecordPickerContent - A context-agnostic record picker component.
 * Supports searching entities and selecting recordId values.
 *
 * Features:
 * - Search across single entity type, multiple entity types, or all entities
 * - Multi-select or single-select mode
 * - Shows selected items at top, available items below
 * - Hydrates selected items using useRelationship hook
 */
export function RecordPickerContent({
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
  onSelectItem,
  externalSearch,
}: RecordPickerContentProps) {
  const [internalSearch, setInternalSearch] = useState('')
  const search = externalSearch ?? internalSearch
  const setSearch = externalSearch !== undefined ? () => {} : setInternalSearch
  const [debouncedSearch] = useDebouncedValue(search, 300)
  const getResourceById = useResourceStore((s) => s.getResourceById)

  // Notify parent about capture state on mount/unmount
  useEffect(() => {
    onCaptureChange?.(true)
    return () => onCaptureChange?.(false)
  }, [onCaptureChange])

  // Track selected recordIds for layout stability — snapshot at mount,
  // but appends new items added to value (e.g. inline create) so they render immediately
  const [initialSelectedIds, setInitialSelectedIds] = useState<RecordId[]>(() => value)

  // When value gains new items (e.g. after inline create), add them to initialSelectedIds
  useEffect(() => {
    setInitialSelectedIds((prev) => {
      const newIds = value.filter((id) => !prev.includes(id))
      return newIds.length > 0 ? [...prev, ...newIds] : prev
    })
  }, [value])

  // Determine search mode
  const isGlobalSearch = !entityDefinitionId && !entityDefinitionIds
  const isMultiEntitySearch = !!entityDefinitionIds && entityDefinitionIds.length > 0

  // Build search query params
  const searchParams = useMemo(() => {
    if (entityDefinitionIds && entityDefinitionIds.length > 0) {
      // Multi-entity search mode - use global search with filter
      return {
        query: debouncedSearch,
        entityDefinitionIds,
        limit: 20,
      }
    }
    if (entityDefinitionId) {
      // Single entity search mode
      return {
        entityDefinitionId,
        query: debouncedSearch,
        limit: 20,
      }
    }
    // Global search mode
    return {
      query: debouncedSearch,
      limit: 20,
    }
  }, [entityDefinitionId, entityDefinitionIds, debouncedSearch])

  // Search query
  const { data: searchResults, isLoading: isSearching } = api.record.search.useQuery(searchParams, {
    enabled: externalSearch === undefined || debouncedSearch.trim().length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })

  // Hydrate selected items
  const { items: hydratedItems, isLoading: isHydrating } = useRelationship(initialSelectedIds)

  // Build map of hydrated items for quick lookup
  const hydratedMap = useMemo(() => {
    const map: Record<string, RecordPickerItem> = {}
    initialSelectedIds.forEach((recordId, idx) => {
      const item = hydratedItems[idx]
      if (item) {
        map[recordId] = item
      }
    })
    return map
  }, [initialSelectedIds, hydratedItems])

  // Check if a recordId is currently selected
  const isSelected = useCallback(
    (recordId: RecordId) => {
      return value.includes(recordId)
    },
    [value]
  )

  // Check if a recordId was initially selected (for layout stability)
  const wasInitiallySelected = useCallback(
    (recordId: RecordId) => {
      return initialSelectedIds.includes(recordId)
    },
    [initialSelectedIds]
  )

  // Filter initially selected items by search term
  const filteredSelectedItems = useMemo(() => {
    const searchLower = search.toLowerCase()
    const items: RecordPickerItem[] = []

    for (const recordId of initialSelectedIds) {
      const item = hydratedMap[recordId]
      if (item) {
        // Apply search filter
        if (!search || item.displayName?.toLowerCase().includes(searchLower)) {
          items.push(item)
        }
      }
    }

    return items
  }, [initialSelectedIds, hydratedMap, search])

  // IDs of items already rendered in the selected section. Used below to dedupe `availableItems` —
  // `wasInitiallySelected` compares by RecordId, which misses cases where the selected value and
  // the search result use different recordId prefixes (system type vs entityDefinitionId UUID).
  // Comparing by raw instance id catches those.
  const selectedItemIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of filteredSelectedItems) {
      ids.add(item.id)
    }
    return ids
  }, [filteredSelectedItems])

  // Available items (from search, excluding initially selected and excluded IDs)
  const availableItems = useMemo(() => {
    if (!searchResults?.items) return []
    return searchResults.items.filter((item) => {
      return (
        !wasInitiallySelected(item.recordId) &&
        !excludeIds.includes(item.recordId) &&
        !selectedItemIds.has(item.id)
      )
    })
  }, [searchResults, wasInitiallySelected, excludeIds, selectedItemIds])

  /**
   * Toggle selection of a record
   */
  const handleToggle = useCallback(
    (recordId: RecordId) => {
      if (multi) {
        // Toggle in array
        const exists = isSelected(recordId)
        let newValue: RecordId[]

        if (exists) {
          newValue = value.filter((v) => v !== recordId)
        } else {
          newValue = [...value, recordId]
        }

        onChange(newValue)
      } else {
        // Single select - replace or deselect if same
        const exists = isSelected(recordId)

        if (exists) {
          onChange([])
        } else {
          onChange([recordId])
          onSelectSingle?.(recordId)
          // Pass full item data if callback provided
          if (onSelectItem) {
            const item =
              searchResults?.items?.find((i) => i.recordId === recordId) ?? hydratedMap[recordId]
            if (item) onSelectItem(item)
          }
        }
      }
    },
    [multi, value, onChange, isSelected, onSelectSingle, onSelectItem, searchResults, hydratedMap]
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
      {externalSearch === undefined && (
        <CommandInput
          placeholder={placeholder}
          value={search}
          onValueChange={setSearch}
          disabled={disabled}
          loading={isLoading}
        />
      )}
      <CommandList>
        {!isSearching && debouncedSearch.trim() && !hasSelectedSection && !hasResultsSection && (
          <CommandPlaceholder>No results found</CommandPlaceholder>
        )}

        {/* Selected Items Section */}
        {hasSelectedSection && (
          <CommandGroup aria-label='Selected Items'>
            {filteredSelectedItems.map((item) => {
              return (
                <RecordItem
                  key={item.recordId}
                  item={item}
                  isSelected={isSelected(item.recordId)}
                  onToggle={handleToggle}
                  showEntityType={showEntityType}
                  multi={multi}
                />
              )
            })}
          </CommandGroup>
        )}

        {/* Separator between sections */}
        {hasSelectedSection && hasResultsSection && <CommandSeparator />}

        {/* Available Items Section */}
        {hasResultsSection && (
          <CommandGroup aria-label='Available Items'>
            {availableItems.map((item) => {
              return (
                <RecordItem
                  key={item.recordId}
                  item={item}
                  isSelected={isSelected(item.recordId)}
                  onToggle={handleToggle}
                  showEntityType={showEntityType}
                  multi={multi}
                />
              )
            })}
          </CommandGroup>
        )}

        {/* Create Option */}
        {canCreate && onCreate && (
          <>
            {(hasSelectedSection || hasResultsSection) && <CommandSeparator />}
            <CommandGroup aria-label='Create'>
              <CommandItem onSelect={onCreate} disabled={disabled}>
                <Plus />
                {createLabel || `Create ${relatedResource?.label ?? 'Item'}`}
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </Command>
  )
}
