// apps/web/src/components/resources/hooks/use-actor.ts

import type { Actor, ActorId } from '@auxx/types/actor'
import { parseActorId } from '@auxx/types/actor'
import type { GroupMember } from '@auxx/types/groups'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useShallow } from 'zustand/shallow'
import { api } from '~/trpc/react'
import { getActorStoreState, useActorStore } from '../store/actor-store'

/** Stable empty array to prevent re-renders */
const EMPTY_MEMBERS: GroupMember[] = []

// ============================================================================
// useActor - Get a single actor
// ============================================================================

interface UseActorOptions {
  /** ActorId to fetch (e.g., 'user:abc123' or 'group:xyz789') */
  actorId: ActorId | null | undefined
  /** Enable/disable the hook */
  enabled?: boolean
}

interface UseActorResult {
  /** The resolved actor */
  actor: Actor | undefined
  /** Whether the actor is being fetched */
  isLoading: boolean
  /** Whether the actor was not found */
  isNotFound: boolean
}

/**
 * Hook to get a single actor by ActorId.
 *
 * @example
 * const { actor } = useActor({ actorId: 'user:abc123' })
 * const { actor } = useActor({ actorId: 'group:xyz789' })
 */
export function useActor({ actorId, enabled = true }: UseActorOptions): UseActorResult {
  // Subscribe to actor (primitive selector - returns same reference if actor unchanged)
  const actor = useActorStore((state) => (actorId ? state.actors.get(actorId) : undefined))

  // Subscribe to loading state
  const isLoading = useActorStore((state) =>
    actorId ? state.loadingIds.has(actorId) || state.pendingIds.has(actorId) : false
  )

  // Subscribe to not found state (primitive boolean - stable)
  const isNotFound = useActorStore((state) => (actorId ? state.notFoundIds.has(actorId) : false))

  // Track requested IDs to prevent duplicate requests
  const requestedRef = useRef<Set<ActorId>>(new Set())

  // Get request action (stable reference from store)
  const requestActor = useActorStore((s) => s.requestActor)

  // Request fetch in useLayoutEffect - runs synchronously before paint
  // This prevents the flicker where the component renders with isLoading=false
  useLayoutEffect(() => {
    if (!enabled || !actorId) return
    if (actor) return
    if (requestedRef.current.has(actorId)) return

    requestedRef.current.add(actorId)
    requestActor(actorId)
  }, [enabled, actorId, actor, requestActor])

  // Clear on actorId change
  useEffect(() => {
    requestedRef.current.clear()
  }, [actorId])

  return {
    actor,
    isLoading: !actor && isLoading,
    isNotFound,
  }
}

// ============================================================================
// useActors - Get multiple actors
// ============================================================================

/**
 * Hook to get multiple actors by ActorId.
 * Returns a Map for O(1) lookup.
 * Uses useShallow to prevent infinite loops from new Map references.
 *
 * @example
 * const actors = useActors(['user:a', 'group:b'])
 * const actor = actors.get('user:a')
 */
export function useActors(actorIds: ActorId[]): Map<ActorId, Actor> {
  // Create stable key for comparison
  const idsKey = actorIds.join(',')

  return useActorStore(
    useShallow((state) => {
      const result = new Map<ActorId, Actor>()
      for (const id of idsKey.split(',').filter(Boolean)) {
        const actor = state.actors.get(id as ActorId)
        if (actor) result.set(id as ActorId, actor)
      }
      return result
    })
  )
}

// ============================================================================
// useAvailableActors - Get all available actors for selection
// ============================================================================

interface UseAvailableActorsOptions {
  /** Filter to specific target: 'user', 'group', or 'both' */
  target?: 'user' | 'group' | 'both'
  /** Filter users by role */
  roles?: ('OWNER' | 'ADMIN' | 'USER')[]
  /** Filter to specific group IDs */
  groupIds?: string[]
}

/**
 * Hook to get all available actors for selection.
 * Uses useShallow to prevent infinite loops from new array references.
 *
 * @example
 * const actors = useAvailableActors({ target: 'user' })
 * const actors = useAvailableActors({ target: 'both', roles: ['ADMIN'] })
 */
export function useAvailableActors(options: UseAvailableActorsOptions = {}): Actor[] {
  const { target, roles, groupIds } = options

  return useActorStore(
    useShallow((state) => {
      let actors = Array.from(state.actors.values())

      // Filter by target
      if (target && target !== 'both') {
        actors = actors.filter((a) => a.type === target)
      }

      // Filter by role (users only)
      if (roles?.length) {
        actors = actors.filter((a) => a.type !== 'user' || roles.includes(a.role))
      }

      // Filter by groupIds (groups only)
      if (groupIds?.length) {
        actors = actors.filter((a) => {
          if (a.type !== 'group') return true
          try {
            const { id } = parseActorId(a.actorId)
            return groupIds.includes(id)
          } catch {
            return false
          }
        })
      }

      return actors
    })
  )
}

// ============================================================================
// useGroupMembers - Get members of a group
// ============================================================================

interface UseGroupMembersOptions {
  /** ActorId of the group (e.g., 'group:xyz789') or raw groupId */
  groupId: string | ActorId | null | undefined
  /** Enable/disable the hook */
  enabled?: boolean
}

interface UseGroupMembersResult {
  /** Group members */
  members: GroupMember[]
  /** Whether members are being fetched */
  isLoading: boolean
  /** Refetch members */
  refetch: () => void
}

/**
 * Hook to get members of a group.
 *
 * @example
 * const { members } = useGroupMembers({ groupId: 'group:xyz789' })
 */
export function useGroupMembers({
  groupId: rawGroupId,
  enabled = true,
}: UseGroupMembersOptions): UseGroupMembersResult {
  // Parse if ActorId format
  let groupId: string | null = null
  if (rawGroupId) {
    if (rawGroupId.startsWith('group:')) {
      try {
        groupId = parseActorId(rawGroupId as ActorId).id
      } catch {
        groupId = rawGroupId
      }
    } else {
      groupId = rawGroupId
    }
  }

  // Subscribe to cached members
  const members = useActorStore((state) => (groupId ? state.groupMembers.get(groupId) : undefined))
  const safeMembers = members ?? EMPTY_MEMBERS

  // Fetch if not cached
  const { data, isLoading, refetch } = api.actor.getGroupMembers.useQuery(
    { groupId: groupId! },
    {
      enabled: enabled && !!groupId && safeMembers.length === 0,
      staleTime: 5 * 60 * 1000,
    }
  )

  // Sync to store
  useEffect(() => {
    if (data && groupId) {
      getActorStoreState().setGroupMembers(groupId, data)
    }
  }, [data, groupId])

  return {
    members: safeMembers,
    isLoading,
    refetch,
  }
}

// ============================================================================
// useActorLoading - Check if the actor store is loading
// ============================================================================

/**
 * Hook to check if the actor store is loading initial data.
 */
export function useActorLoading(): boolean {
  return useActorStore((s) => s.loading)
}

/**
 * Hook to check if the actor store is initialized.
 */
export function useActorInitialized(): boolean {
  return useActorStore((s) => s.initialized)
}
