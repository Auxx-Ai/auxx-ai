// apps/web/src/components/contacts/input/relationship-input-field.tsx

import { useState, useMemo, useEffect, useRef } from 'react'
import { usePropertyContext } from '../drawer/property-provider'
import { useFieldNavigationOptional } from '../drawer/field-navigation-context'
import { useRelationship } from '~/components/resources'
import { useResourceIdFromField } from '../utils/use-resource-id-from-field'
import { api } from '~/trpc/react'
import { Check } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { cn } from '@auxx/ui/lib/utils'
import type { ResourcePickerItem } from '@auxx/lib/resources/client'

/**
 * Input component for RELATIONSHIP field type
 * Displays an inline searchable list with selected items at top.
 *
 * Pattern E: Save-on-close
 * - Local state for selection tracking
 * - Uses onBeforeClose hook for fire-and-forget save
 * - CAPTURES arrow keys for list navigation
 */
export function RelationshipInputField() {
  const { value, field, commitValue, onBeforeClose } = usePropertyContext()
  const nav = useFieldNavigationOptional()
  const [search, setSearch] = useState('')

  // Capture keys while open (list uses arrows)
  useEffect(() => {
    nav?.setPopoverCapturing(true)
    return () => nav?.setPopoverCapturing(false)
  }, [nav])

  // Track initial selected IDs (snapshot at mount) - prevents layout shifts
  const [initialSelectedIds, setInitialSelectedIds] = useState<Set<string>>(
    () => new Set(Array.isArray(value) ? value : [])
  )

  // Track current selection (what will be saved)
  const [currentSelectedIds, setCurrentSelectedIds] = useState<Set<string>>(
    () => new Set(Array.isArray(value) ? value : [])
  )

  // Ref to track current selection for save-on-close
  const currentSelectedRef = useRef<Set<string>>(currentSelectedIds)

  const relationship = field.options?.relationship
  const isSingleSelect =
    relationship?.relationshipType === 'belongs_to' || relationship?.relationshipType === 'has_one'

  // Determine resourceId using hook (looks up apiSlug for custom entities)
  const resourceId = useResourceIdFromField(field)

  // Hydrate selected items via global store (always available even if not in search)
  const selectedIdsArray = useMemo(() => Array.from(initialSelectedIds), [initialSelectedIds])
  const { items: hydratedSelectedItems } = useRelationship(resourceId, selectedIdsArray)

  // Build map of hydrated selected items
  const hydratedSelectedMap = useMemo(() => {
    const map: Record<string, ResourcePickerItem> = {}
    selectedIdsArray.forEach((id, idx) => {
      const item = hydratedSelectedItems[idx]
      if (item) {
        map[id] = item
      }
    })
    return map
  }, [selectedIdsArray, hydratedSelectedItems])

  // Always fetch search results
  const { data: searchResults, isLoading } = api.resource.search.useQuery(
    { tableId: resourceId!, search, limit: 20 },
    { enabled: !!resourceId }
  )

  // Keep ref in sync with state
  useEffect(() => {
    currentSelectedRef.current = currentSelectedIds
  }, [currentSelectedIds])

  // Reset selection state when value prop changes from parent
  useEffect(() => {
    const newIds = new Set(Array.isArray(value) ? value : [])
    setInitialSelectedIds(newIds)
    setCurrentSelectedIds(newIds)
    currentSelectedRef.current = newIds
  }, [value])

  // Register save handler for popover close - fire-and-forget
  useEffect(() => {
    onBeforeClose.current = () => {
      const currentIds = Array.from(currentSelectedRef.current)
      const originalIds = Array.isArray(value) ? value : []
      // Only save if selection changed
      const hasChanged =
        currentIds.length !== originalIds.length ||
        currentIds.some((id) => !originalIds.includes(id))
      if (hasChanged) {
        commitValue(currentIds)
      }
    }
    return () => {
      onBeforeClose.current = undefined
    }
  }, [onBeforeClose, value, commitValue])

  // Build selected items - prefer hydrated from store, fall back to search results
  const initiallySelectedItems = useMemo(() => {
    const searchLower = search.toLowerCase()
    const items: ResourcePickerItem[] = []

    for (const id of initialSelectedIds) {
      // Try hydrated from global store first
      const fromStore = hydratedSelectedMap[id]
      if (fromStore) {
        // Apply search filter
        if (fromStore.displayName?.toLowerCase().includes(searchLower) ?? true) {
          items.push(fromStore)
        }
        continue
      }

      // Fall back to search results
      const fromSearch = searchResults?.items?.find((item) => item.id === id)
      if (fromSearch) {
        if (fromSearch.displayName?.toLowerCase().includes(searchLower) ?? true) {
          items.push(fromSearch)
        }
      }
    }

    return items
  }, [initialSelectedIds, hydratedSelectedMap, searchResults, search])

  // Items that were NOT initially selected (show in bottom section)
  const availableItems = useMemo(() => {
    if (!searchResults?.items) return []
    return searchResults.items.filter((item) => !initialSelectedIds.has(item.id))
  }, [searchResults, initialSelectedIds])

  /**
   * Toggle selection of an item (local state only, saves on close)
   */
  const handleToggle = (id: string) => {
    const newSelected = new Set(currentSelectedIds)

    if (isSingleSelect) {
      // For single select, clear and set new (or deselect if same)
      newSelected.clear()
      if (!currentSelectedIds.has(id)) {
        newSelected.add(id)
      }
    } else {
      // For multi select, toggle
      if (newSelected.has(id)) {
        newSelected.delete(id)
      } else {
        newSelected.add(id)
      }
    }

    setCurrentSelectedIds(newSelected)
  }

  if (!resourceId) {
    return <span className="text-muted-foreground p-2">Invalid relationship config</span>
  }

  const hasSelectedSection = initiallySelectedItems.length > 0
  const hasResultsSection = availableItems.length > 0

  return (
    <div className="">
      <Command shouldFilter={false}>
        <CommandInput placeholder="Search..." value={search} onValueChange={setSearch} />
        <CommandList>
          <CommandEmpty>{isLoading ? 'Searching...' : 'No results found'}</CommandEmpty>

          {/* Selected Items Section */}
          {hasSelectedSection && (
            <div className="p-1" aria-label="Selected Items">
              {initiallySelectedItems.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => handleToggle(item.id)}
                  className="flex items-center gap-2">
                  {item.avatarUrl && (
                    <Avatar className="size-4">
                      <AvatarImage src={item.avatarUrl} />
                      <AvatarFallback>{item.displayName?.[0]}</AvatarFallback>
                    </Avatar>
                  )}
                  <div className="flex flex-1 flex-col">
                    <span className="truncate">{item.displayName}</span>
                    {item.secondaryInfo && (
                      <span className="text-xs text-muted-foreground">{item.secondaryInfo}</span>
                    )}
                  </div>
                  <Check
                    className={cn(
                      'h-4 w-4',
                      currentSelectedIds.has(item.id) ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                </CommandItem>
              ))}
            </div>
          )}

          {/* Separator between sections */}
          {hasSelectedSection && hasResultsSection && <CommandSeparator />}

          {/* Available Items Section */}
          {hasResultsSection && (
            <div className="p-1" aria-label="Results">
              {availableItems.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => handleToggle(item.id)}
                  className="flex items-center gap-2">
                  {item.avatarUrl && (
                    <Avatar className="size-4">
                      <AvatarImage src={item.avatarUrl} />
                      <AvatarFallback>{item.displayName?.[0]}</AvatarFallback>
                    </Avatar>
                  )}
                  <div className="flex flex-1 flex-col">
                    <span className="truncate">{item.displayName}</span>
                    {item.secondaryInfo && (
                      <span className="text-xs text-muted-foreground">{item.secondaryInfo}</span>
                    )}
                  </div>
                  <Check
                    className={cn(
                      'size-4',
                      currentSelectedIds.has(item.id) ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                </CommandItem>
              ))}
            </div>
          )}
        </CommandList>
      </Command>
    </div>
  )
}
