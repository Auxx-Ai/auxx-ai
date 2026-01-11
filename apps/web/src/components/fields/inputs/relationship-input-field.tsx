// apps/web/src/components/fields/inputs/relationship-input-field.tsx

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { usePropertyContext } from '../property-provider'
import { useFieldNavigationOptional } from '../field-navigation-context'
import {
  useRelationship,
  useResourceProvider,
  buildRelationshipKey,
  getRelationshipStoreState,
} from '~/components/resources'
import { useResourceIdFromField } from '../hooks/use-resource-id-from-field'
import { extractRelationshipData } from '@auxx/lib/field-values/client'
import { api } from '~/trpc/react'
import { Check, Plus } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandGroup,
} from '@auxx/ui/components/command'
import { cn } from '@auxx/ui/lib/utils'
import { isCustomResource, type ResourcePickerItem } from '@auxx/lib/resources/client'
import { EntityInstanceDialog } from '~/components/custom-fields/ui/entity-instance-dialog'
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
    () => new Set(extractRelationshipData(value).ids)
  )

  // Track current selection (what will be saved)
  const [currentSelectedIds, setCurrentSelectedIds] = useState<Set<string>>(
    () => new Set(extractRelationshipData(value).ids)
  )

  // Ref to track current selection for save-on-close
  const currentSelectedRef = useRef<Set<string>>(currentSelectedIds)

  const relationship = field.options?.relationship
  const isSingleSelect =
    relationship?.relationshipType === 'belongs_to' || relationship?.relationshipType === 'has_one'

  // Get relatedEntityDefinitionId for storing with values
  const relatedEntityDefinitionId = useMemo(() => {
    // For custom entities, use the stored relatedEntityDefinitionId
    if (relationship.relatedEntityDefinitionId) {
      return relationship.relatedEntityDefinitionId
    }
    // For system resources, use the relatedModelType (e.g., "contact", "ticket")
    if (relationship.relatedModelType) {
      return relationship.relatedModelType
    }
    console.warn(
      '[RelationshipInputField] Neither relatedEntityDefinitionId nor relatedModelType found'
    )
    return ''
  }, [relationship])

  // Determine resourceId using hook - returns { tableId, entityDefinitionId? } or null
  const resourceRef = useResourceIdFromField(field)

  // Dialog state for inline create
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

  // Get resource by ID to determine label and if inline create is supported
  const { getResourceById } = useResourceProvider()

  // Get the related resource for label and inline create capability
  const relatedResource = useMemo(() => {
    if (!resourceRef) return null
    return getResourceById(resourceRef.tableId)
  }, [resourceRef, getResourceById])

  // Only custom resources support inline create (system resources have dedicated flows)
  const canInlineCreate = relatedResource && isCustomResource(relatedResource)

  // For useRelationship, use tableId directly (either system resource or UUID, no prefix needed)
  const resourceIdForHydration = useMemo(() => {
    if (!resourceRef) return null
    return resourceRef.tableId
  }, [resourceRef])

  // Hydrate selected items via global store (always available even if not in search)
  const selectedIdsArray = useMemo(() => Array.from(initialSelectedIds), [initialSelectedIds])
  const { items: hydratedSelectedItems } = useRelationship(resourceIdForHydration, selectedIdsArray)

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
    {
      tableId: resourceRef?.tableId ?? '',
      search,
      limit: 20,
    },
    { enabled: !!resourceRef }
  )

  // Keep ref in sync with state
  useEffect(() => {
    currentSelectedRef.current = currentSelectedIds
  }, [currentSelectedIds])

  // Reset selection state when value prop changes from parent
  useEffect(() => {
    const newIds = new Set(extractRelationshipData(value).ids)
    setInitialSelectedIds(newIds)
    setCurrentSelectedIds(newIds)
    currentSelectedRef.current = newIds
  }, [value])

  // Register save handler for popover close - fire-and-forget
  useEffect(() => {
    onBeforeClose.current = () => {
      const currentIds = Array.from(currentSelectedRef.current)
      const originalIds = extractRelationshipData(value).ids
      // Only save if selection changed
      const hasChanged =
        currentIds.length !== originalIds.length ||
        currentIds.some((id) => !originalIds.includes(id))
      if (hasChanged) {
        // Wrap IDs with relatedEntityDefinitionId for proper storage
        const values = currentIds.map((id) => ({
          relatedEntityId: id,
          relatedEntityDefinitionId,
        }))
        commitValue(values)
      }
    }
    return () => {
      onBeforeClose.current = undefined
    }
  }, [onBeforeClose, value, commitValue, relatedEntityDefinitionId])

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

  /**
   * Open the create dialog for inline entity creation
   */
  const handleOpenCreateDialog = () => {
    setIsCreateDialogOpen(true)
  }

  // Get tRPC utils for fetching
  const utils = api.useUtils()

  /**
   * Handle newly created entity instance
   * - Fetches the new item for hydration
   * - Adds to relationship store
   * - Selects the new item
   * - Closes the dialog
   */
  const handleCreatedInstance = useCallback(
    async (instanceId: string) => {
      if (!resourceRef) return

      try {
        // Fetch the newly created item to get display info
        const newItem = await utils.resource.getById.fetch({
          tableId: resourceRef.tableId,
          id: instanceId,
        })

        if (newItem) {
          // Add to relationship store for immediate hydration
          const key = buildRelationshipKey(resourceRef.tableId, instanceId)
          getRelationshipStoreState().addHydratedItems({ [key]: newItem })
        }
      } catch (error) {
        // Non-critical: item will be fetched on next hydration cycle
        console.warn('Failed to fetch newly created item:', error)
      }

      // Select the new item
      if (isSingleSelect) {
        setCurrentSelectedIds(new Set([instanceId]))
      } else {
        setCurrentSelectedIds((prev) => new Set([...prev, instanceId]))
      }

      // Update initial selected IDs to keep item in "Selected Items" section
      setInitialSelectedIds((prev) => new Set([...prev, instanceId]))

      // Close dialog
      setIsCreateDialogOpen(false)
    },
    [resourceRef, isSingleSelect, utils]
  )

  if (!resourceRef) {
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
            <CommandGroup aria-label="Selected Items">
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
                  <div className="flex flex-1 items-center gap-1 flex-row">
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
            </CommandGroup>
          )}

          {/* Separator between sections */}
          {hasSelectedSection && hasResultsSection && <CommandSeparator />}

          {/* Available Items Section */}
          {hasResultsSection && (
            <CommandGroup aria-label="Available Items">
              {availableItems.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => handleToggle(item.id)}
                  className="flex items-center  gap-2">
                  {item.avatarUrl && (
                    <Avatar className="size-4">
                      <AvatarImage src={item.avatarUrl} />
                      <AvatarFallback>{item.displayName?.[0]}</AvatarFallback>
                    </Avatar>
                  )}
                  <div className="flex flex-1 flex-row items-center gap-1">
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
            </CommandGroup>
          )}
          {/* Create Option (only for custom resources) */}
          {canInlineCreate && (
            <>
              {(hasSelectedSection || hasResultsSection) && <CommandSeparator />}
              <CommandGroup aria-label="Create">
                <CommandItem onSelect={handleOpenCreateDialog}>
                  <Plus />
                  Create {relatedResource?.label ?? 'Item'}
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>

      {/* Inline Create Dialog */}
      {canInlineCreate && relatedResource && (
        <EntityInstanceDialog
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
          entityDefinitionId={relatedResource.entityDefinitionId!}
          onSaved={handleCreatedInstance}
        />
      )}
    </div>
  )
}
