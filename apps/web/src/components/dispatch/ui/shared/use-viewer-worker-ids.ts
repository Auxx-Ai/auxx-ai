// apps/web/src/components/dispatch/ui/shared/use-viewer-worker-ids.ts

'use client'

import { useMemo } from 'react'
import { useUser } from '~/hooks/use-user'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'

/**
 * The signed-in user's dispatch worker ids: their own individual worker row plus every team they
 * belong to — the client mirror of `resolveUserWorkerIds` (45-teams.md §5.3). Used to scope the
 * optimistic `myVisits` cache patch: a visit is "mine" when its `assigneeWorkerId` is in this set
 * (an individual assignment OR a team the viewer is on). Empty until `listWorkers` loads or when
 * the viewer has no worker row.
 */
export function useViewerWorkerIds(): string[] {
  const { userId } = useUser()
  const { data: workers } = api.dispatch.listWorkers.useQuery(undefined, {
    staleTime: ORG_STATIC_STALE_TIME,
  })
  return useMemo(() => {
    if (!userId || !workers) return []
    const mine = workers.find((w) => w.type === 'individual' && w.userId === userId)
    if (!mine) return []
    const teamIds = workers
      .filter((w) => w.type === 'team' && (w.members ?? []).some((m) => m.workerId === mine.id))
      .map((w) => w.id)
    return [mine.id, ...teamIds]
  }, [userId, workers])
}
