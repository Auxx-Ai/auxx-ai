// apps/web/src/components/pickers/actor-picker/actor-picker-content.tsx

'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { keepPreviousData } from '@tanstack/react-query'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandList,
  CommandSeparator,
  CommandGroup,
} from '@auxx/ui/components/command'
import { cn } from '@auxx/ui/lib/utils'
import type { Actor, ActorId, ActorType } from '@auxx/types/actor'
import { useAvailableActors, useActors } from '~/components/resources/hooks/use-actor'
import { api } from '~/trpc/react'
import { ActorItem } from './actor-item'

/** Stable default for actor types to prevent re-renders */
const DEFAULT_ACTOR_TYPES: ActorType[] = ['user', 'group']

/** Stable empty array for excludeIds to prevent re-renders */
const EMPTY_EXCLUDE_IDS: ActorId[] = []

/**
 * Props for the ActorPickerContent component
 */
export interface ActorPickerContentProps {
  /** Currently selected ActorIds */
  value: ActorId[]

  /** Called when selection changes */
  onChange: (selected: ActorId[]) => void

  /** Actor types to show: 'user', 'group', or both */
  types?: ActorType[]

  /** Filter by roles (for users) */
  roles?: string[]

  /** Multi-select mode (default: true) */
  multi?: boolean

  /** Called after selection in single-select mode */
  onSelectSingle?: (actorId: ActorId) => void

  /** Callback when arrow key capture state changes */
  onCaptureChange?: (capturing: boolean) => void

  /** Disabled state */
  disabled?: boolean

  /** Search placeholder */
  placeholder?: string

  /** Loading state */
  isLoading?: boolean

  /** Additional className */
  className?: string

  /** ActorIds to exclude from results */
  excludeIds?: ActorId[]
}

/**
 * ActorPickerContent - A context-agnostic actor picker component.
 * Supports searching users and groups.
 *
 * Features:
 * - Search across users, groups, or both
 * - Multi-select or single-select mode
 * - Shows selected items at top, available items below
 * - Groups results by type when showing both users and groups
 */
export function ActorPickerContent({
  value,
  onChange,
  types = DEFAULT_ACTOR_TYPES,
  roles,
  multi = true,
  onSelectSingle,
  onCaptureChange,
  disabled = false,
  placeholder = 'Search...',
  isLoading: externalLoading = false,
  className,
  excludeIds = EMPTY_EXCLUDE_IDS,
}: ActorPickerContentProps) {
  const [search, setSearch] = useState('')

  // Notify parent about capture state on mount/unmount
  useEffect(() => {
    onCaptureChange?.(true)
    return () => onCaptureChange?.(false)
  }, [onCaptureChange])

  // Track initial selected actorIds (snapshot at mount) - prevents layout shifts
  const [initialSelectedIds] = useState<ActorId[]>(() => value)

  // Get actors from store (preloaded)
  const storeActors = useAvailableActors({ types, roles: roles as any })

  // Search query for typeahead (when search is active)
  const { data: searchResults, isLoading: isSearching } = api.actor.search.useQuery(
    { query: search, types, roles: roles as any, limit: 20 },
    { enabled: search.length >= 2, placeholderData: keepPreviousData }
  )

  // Hydrate selected items
  const hydratedActors = useActors(initialSelectedIds)

  // Check if an actorId is currently selected
  const isSelected = useCallback(
    (actorId: ActorId) => {
      return value.includes(actorId)
    },
    [value]
  )

  // Check if an actorId was initially selected (for layout stability)
  const wasInitiallySelected = useCallback(
    (actorId: ActorId) => {
      return initialSelectedIds.includes(actorId)
    },
    [initialSelectedIds]
  )

  // Filter initially selected items by search term
  const filteredSelectedItems = useMemo(() => {
    const searchLower = search.toLowerCase()
    const items: Actor[] = []

    for (const actorId of initialSelectedIds) {
      const actor = hydratedActors.get(actorId)
      if (actor) {
        // Apply search filter
        if (!search || actor.name.toLowerCase().includes(searchLower)) {
          items.push(actor)
        }
      }
    }

    return items
  }, [initialSelectedIds, hydratedActors, search])

  // Available items (from search or store, excluding initially selected and excluded IDs)
  const availableItems = useMemo(() => {
    // Use search results if searching, otherwise use store actors
    const sourceActors = search.length >= 2 && searchResults ? searchResults : storeActors

    return sourceActors.filter((actor) => {
      return !wasInitiallySelected(actor.actorId) && !excludeIds.includes(actor.actorId)
    })
  }, [search, searchResults, storeActors, wasInitiallySelected, excludeIds])

  // Group available items by type
  const groupedAvailable = useMemo(() => {
    const users = availableItems.filter((a) => a.type === 'user')
    const groups = availableItems.filter((a) => a.type === 'group')
    return { users, groups }
  }, [availableItems])

  /**
   * Toggle selection of an actor
   */
  const handleToggle = useCallback(
    (actorId: ActorId) => {
      if (multi) {
        // Toggle in array
        const exists = isSelected(actorId)
        let newValue: ActorId[]

        if (exists) {
          newValue = value.filter((v) => v !== actorId)
        } else {
          newValue = [...value, actorId]
        }

        onChange(newValue)
      } else {
        // Single select - replace or deselect if same
        const exists = isSelected(actorId)

        if (exists) {
          onChange([])
        } else {
          onChange([actorId])
          onSelectSingle?.(actorId)
        }
      }
    },
    [multi, value, onChange, isSelected, onSelectSingle]
  )

  const isLoading = externalLoading || isSearching
  const hasSelectedSection = filteredSelectedItems.length > 0
  const hasUsersSection = types.includes('user') && groupedAvailable.users.length > 0
  const hasGroupsSection = types.includes('group') && groupedAvailable.groups.length > 0
  const hasResultsSection = hasUsersSection || hasGroupsSection
  const showGroupHeadings = types.length > 1

  return (
    <Command shouldFilter={false} className={cn('rounded-lg', className)}>
      <CommandInput
        placeholder={placeholder}
        value={search}
        onValueChange={setSearch}
        disabled={disabled}
        loading={isLoading}
      />
      <CommandList>
        <CommandEmpty>No results found</CommandEmpty>

        {/* Selected Items Section */}
        {hasSelectedSection && (
          <CommandGroup aria-label="Selected">
            {filteredSelectedItems.map((actor) => (
              <ActorItem
                key={actor.actorId}
                actor={actor}
                isSelected={isSelected(actor.actorId)}
                onToggle={handleToggle}
                multi={multi}
              />
            ))}
          </CommandGroup>
        )}

        {/* Separator between sections */}
        {hasSelectedSection && hasResultsSection && <CommandSeparator />}

        {/* Users Section */}
        {hasUsersSection && (
          <CommandGroup heading={showGroupHeadings ? 'Users' : undefined} aria-label="Users">
            {groupedAvailable.users.map((actor) => (
              <ActorItem
                key={actor.actorId}
                actor={actor}
                isSelected={isSelected(actor.actorId)}
                onToggle={handleToggle}
                multi={multi}
              />
            ))}
          </CommandGroup>
        )}

        {/* Groups Section */}
        {hasGroupsSection && (
          <CommandGroup heading={showGroupHeadings ? 'Groups' : undefined} aria-label="Groups">
            {groupedAvailable.groups.map((actor) => (
              <ActorItem
                key={actor.actorId}
                actor={actor}
                isSelected={isSelected(actor.actorId)}
                onToggle={handleToggle}
                multi={multi}
              />
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
