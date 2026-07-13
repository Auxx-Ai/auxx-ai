// apps/web/src/components/dispatch/ui/shared/use-worker-actor-excludes.ts

import { type ActorId, getActorRawId } from '@auxx/types/actor'
import { useMemo } from 'react'
import { useAvailableActors } from '~/components/resources/hooks/use-actor'
import { api } from '~/trpc/react'

/**
 * Worker-filtered `excludeIds` recipe for the assignee actor picker (extracted verbatim from
 * `schedule-popover.tsx:228-240`) — only active dispatch workers should be selectable in the
 * Assignee row, so every other `user` actor is excluded from `ActorPickerContent`.
 */
export function useWorkerActorExcludes(): ActorId[] {
  const workersQuery = api.dispatch.listWorkers.useQuery()
  const activeWorkers = useMemo(
    () => (workersQuery.data ?? []).filter((w) => w.isActive),
    [workersQuery.data]
  )
  const allUserActors = useAvailableActors({ target: 'user' })
  return useMemo(() => {
    if (activeWorkers.length === 0) return []
    const workerUserIds = new Set(activeWorkers.map((w) => w.userId))
    return allUserActors
      .filter((a) => !workerUserIds.has(getActorRawId(a.actorId)))
      .map((a) => a.actorId)
  }, [activeWorkers, allUserActors])
}
