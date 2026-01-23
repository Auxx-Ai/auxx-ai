// apps/web/src/components/resources/hooks/use-actor.ts

import { useCallback, useEffect, useRef } from 'react'
import { useActorStore, getActorStoreState } from '../store/actor-store'
import type { Actor, ActorId, ActorType } from '@auxx/types/actor'
import { parseActorId } from '@auxx/types/actor'
import type { GroupMember } from '@auxx/types/groups'
import { api } from '~/trpc/react'

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
  // Subscribe to actor
  const actor = useActorStore(
    useCallback((state) => (actorId ? state.actors.get(actorId) : undefined), [actorId])
  )

  // Subscribe to loading state
  const isLoading = useActorStore(
    useCallback(
      (state) =>
        actorId ? state.loadingIds.has(actorId) || state.pendingIds.has(actorId) : false,
      [actorId]
    )
  )

  // Subscribe to not found state
  const isNotFound = useActorStore(
    useCallback((state) => (actorId ? state.notFoundIds.has(actorId) : false), [actorId])
  )

  // Track requested IDs
  const requestedRef = useRef<Set<ActorId>>(new Set())
  const requestActor = useActorStore((s) => s.requestActor)

  // Request if not cached
  useEffect(() => {
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
 *
 * @example
 * const actors = useActors(['user:a', 'group:b'])
 * const actor = actors.get('user:a')
 */
export function useActors(actorIds: ActorId[]): Map<ActorId, Actor> {
  return useActorStore(
    useCallback(
      (state) => {
        const result = new Map<ActorId, Actor>()
        for (const actorId of actorIds) {
          const actor = state.actors.get(actorId)
          if (actor) result.set(actorId, actor)
        }
        return result
      },
      [actorIds]
    )
  )
}

// ============================================================================
// useAvailableActors - Get all available actors for selection
// ============================================================================

interface UseAvailableActorsOptions {
  /** Filter to specific types */
  types?: ActorType[]
  /** Filter users by role */
  roles?: ('OWNER' | 'ADMIN' | 'USER')[]
  /** Filter to specific group IDs */
  groupIds?: string[]
}

/**
 * Hook to get all available actors for selection.
 *
 * @example
 * const actors = useAvailableActors({ types: ['user'] })
 * const actors = useAvailableActors({ types: ['user', 'group'], roles: ['ADMIN'] })
 */
export function useAvailableActors(options: UseAvailableActorsOptions = {}): Actor[] {
  const { types, roles, groupIds } = options

  return useActorStore(
    useCallback(
      (state) => {
        let actors = Array.from(state.actors.values())

        // Filter by type
        if (types?.length) {
          actors = actors.filter((a) => types.includes(a.type))
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
      },
      [types, roles, groupIds]
    )
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
  const members = useActorStore(
    useCallback((state) => (groupId ? state.groupMembers.get(groupId) ?? [] : []), [groupId])
  )

  // Fetch if not cached
  const { data, isLoading, refetch } = api.actor.getGroupMembers.useQuery(
    { groupId: groupId! },
    {
      enabled: enabled && !!groupId && members.length === 0,
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
    members,
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
