// apps/web/src/components/pickers/actor-picker/actor-picker-content.tsx

'use client'

import type { Actor, ActorId } from '@auxx/types/actor'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { cn } from '@auxx/ui/lib/utils'
import { keepPreviousData } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useActors, useAvailableActors } from '~/components/resources/hooks/use-actor'
import { api } from '~/trpc/react'
import { ActorItem } from './actor-item'

/** Stable empty array for excludeIds to prevent re-renders */
const EMPTY_EXCLUDE_IDS: ActorId[] = []

/**
 * Sentinel ActorId that represents "the user viewing this page at query time".
 * Flows through `value`/`onChange` like any other ActorId; callers in filter-builder
 * contexts translate it to `valueSource: 'currentUser'` when persisting the condition.
 */
export const CURRENT_USER_ACTOR_ID = 'placeholder:currentUser' as ActorId

/** Synthetic Actor used to render the sentinel with the shared ActorItem UI. */
export const CURRENT_USER_ACTOR: Actor = {
  actorId: CURRENT_USER_ACTOR_ID,
  type: 'user',
  name: 'Current user',
  email: '',
  avatarUrl: null,
  role: 'USER',
}

/**
 * Props for the ActorPickerContent component
 */
export interface ActorPickerContentProps {
  /** Currently selected ActorIds */
  value: ActorId[]

  /** Called when selection changes */
  onChange: (selected: ActorId[]) => void

  /**
   * Actor target: 'user', 'group', 'agent', 'worker', 'both', or 'all'
   * (default: 'both').
   *
   * There is deliberately **no `'profile'` target.** Permission profiles are a
   * `ResourceAccess`/`PermissionGrant` grantee kind, not actors: the actor
   * service cannot resolve a `profile:` id to a name or avatar, and
   * profile-grantee `ResourceAccess` writes are still refused server-side
   * (`assertProfileGranteeSupported`, plan 19 step 9). Adding the option before
   * both land would ship a picker entry whose every selection renders "Unknown"
   * and then 400s on save. Every "add grantee" surface funnels through here, so
   * profile grantees are explicitly **unsupported in all pickers** for now; doc
   * 19 §7's Profiles editor is where profile-scoped access is authored.
   */
  target?: 'user' | 'group' | 'agent' | 'worker' | 'both' | 'all'

  /**
   * When `target === 'both'`, include agents in the user/agent sections.
   * Default false — most pickers want humans only.
   */
  includeAgents?: boolean

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

  /**
   * Optional predicate to narrow which agents appear (by their ActorId).
   * Applied to the agent group only — users/groups are untouched. Used by
   * the chat-widget settings to surface chat-kind agents only.
   */
  agentFilter?: (actorId: ActorId) => boolean

  /**
   * Show a "Current user" pseudo-row. Selecting it toggles `CURRENT_USER_ACTOR_ID`
   * in `value` via the normal onChange — the picker does not know about filter
   * semantics. Only intended for filter-builder contexts (tables, mail views).
   *
   * Sugar for `pinnedItem={CURRENT_USER_ACTOR}`.
   */
  allowCurrentUser?: boolean

  /**
   * A synthetic actor pinned above the results in its own group, for a choice
   * that is not a real actor — "Current user" in filter builders, "Own
   * permissions" in the agent builder's run-as row.
   *
   * Its `actorId` is a sentinel that flows through `value`/`onChange` like any
   * other, so the picker stays ignorant of what the caller means by it; the
   * caller translates it on save. Ignored when `allowCurrentUser` is set.
   */
  pinnedItem?: Actor

  /**
   * Externally controlled search string. When defined, the picker uses this value
   * instead of its internal state. Pair with `showInput={false}` to share a single
   * search input across tabbed pickers (e.g. ReferencePickerContent).
   */
  externalSearch?: string

  /** Whether to render the internal search input. Default: true. */
  showInput?: boolean
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
  target = 'both',
  includeAgents,
  roles,
  multi = true,
  onSelectSingle,
  onCaptureChange,
  disabled = false,
  placeholder = 'Search...',
  isLoading: externalLoading = false,
  className,
  excludeIds = EMPTY_EXCLUDE_IDS,
  agentFilter,
  allowCurrentUser = false,
  pinnedItem,
  externalSearch,
  showInput = true,
}: ActorPickerContentProps) {
  const [internalSearch, setInternalSearch] = useState('')
  const search = externalSearch !== undefined ? externalSearch : internalSearch
  const setSearch = setInternalSearch

  const pinned = allowCurrentUser ? CURRENT_USER_ACTOR : pinnedItem

  // Notify parent about capture state on mount/unmount
  useEffect(() => {
    onCaptureChange?.(true)
    return () => onCaptureChange?.(false)
  }, [onCaptureChange])

  // Track initial selected actorIds (snapshot at mount) - prevents layout shifts.
  // Exclude the pinned sentinel — it is rendered by its own pinned row, not via
  // actor hydration (the actor service cannot resolve a synthetic id).
  const [initialSelectedIds] = useState<ActorId[]>(() =>
    value.filter((id) => id !== pinned?.actorId)
  )

  // Get actors from store (preloaded)
  const storeActors = useAvailableActors({ target, roles: roles as any })

  // Search query for typeahead (when search is active)
  const { data: searchResults, isLoading: isSearching } = api.actor.search.useQuery(
    { query: search, target, roles: roles as any, limit: 20 },
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

  /**
   * Group available items by type. The buckets are **exhaustive**: anything the
   * four named sections don't claim lands in `others` instead of disappearing.
   * The previous four filters silently dropped every unbucketed kind — today the
   * org's `system` actor, tomorrow anything the actor union gains — which made
   * `target='all'` quietly not mean "all".
   */
  const groupedAvailable = useMemo(() => {
    const users: Actor[] = []
    const agents: Actor[] = []
    const groups: Actor[] = []
    const workers: Actor[] = []
    const others: Actor[] = []
    for (const actor of availableItems) {
      if (actor.type === 'user') users.push(actor)
      else if (actor.type === 'agent') {
        if (!agentFilter || agentFilter(actor.actorId)) agents.push(actor)
      } else if (actor.type === 'group') groups.push(actor)
      else if (actor.type === 'worker') workers.push(actor)
      else others.push(actor)
    }
    return { users, agents, groups, workers, others }
  }, [availableItems, agentFilter])

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
  const hasUsersSection =
    (target === 'user' || target === 'both' || target === 'all') &&
    groupedAvailable.users.length > 0
  const hasAgentsSection =
    (target === 'agent' || target === 'all' || (target === 'both' && (includeAgents ?? false))) &&
    groupedAvailable.agents.length > 0
  const hasGroupsSection =
    (target === 'group' || target === 'both' || target === 'all') &&
    groupedAvailable.groups.length > 0
  const hasWorkersSection =
    (target === 'worker' || target === 'all') && groupedAvailable.workers.length > 0
  // Only `all` promises everything, so only `all` renders the catch-all bucket.
  const hasOthersSection = target === 'all' && groupedAvailable.others.length > 0
  const hasResultsSection =
    hasUsersSection || hasAgentsSection || hasGroupsSection || hasWorkersSection || hasOthersSection
  const showGroupHeadings = target === 'both' || target === 'all'

  return (
    <Command shouldFilter={false} className={cn('rounded-lg', className)}>
      {showInput && (
        <CommandInput
          placeholder={placeholder}
          value={search}
          onValueChange={setSearch}
          disabled={disabled}
          loading={isLoading}
          autoFocus
        />
      )}
      <CommandList>
        <CommandEmpty>No results found</CommandEmpty>

        {pinned && (!search || pinned.name.toLowerCase().includes(search.toLowerCase())) && (
          <>
            <CommandGroup aria-label='Placeholder'>
              <ActorItem
                actor={pinned}
                isSelected={isSelected(pinned.actorId)}
                onToggle={handleToggle}
                multi={multi}
              />
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {/* Selected Items Section */}
        {hasSelectedSection && (
          <CommandGroup aria-label='Selected'>
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
          <CommandGroup heading={showGroupHeadings ? 'Users' : undefined} aria-label='Users'>
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

        {/* Agents Section */}
        {hasAgentsSection && (
          <CommandGroup heading={showGroupHeadings ? 'Agents' : undefined} aria-label='Agents'>
            {groupedAvailable.agents.map((actor) => (
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
          <CommandGroup heading={showGroupHeadings ? 'Groups' : undefined} aria-label='Groups'>
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

        {/* Workers Section (individuals + teams together, one flat list) */}
        {hasWorkersSection && (
          <CommandGroup heading={showGroupHeadings ? 'Workers' : undefined} aria-label='Workers'>
            {groupedAvailable.workers.map((actor) => (
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

        {/* Catch-all for kinds the four sections above don't claim (e.g. the
            org's system actor), so `target='all'` never silently omits one. */}
        {hasOthersSection && (
          <CommandGroup heading={showGroupHeadings ? 'Other' : undefined} aria-label='Other'>
            {groupedAvailable.others.map((actor) => (
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
