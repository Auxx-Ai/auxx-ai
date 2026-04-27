// apps/web/src/components/favorites/hooks/use-favorite-workflow.ts
'use client'

import { api } from '~/trpc/react'

const STALE_TIME = 5 * 60 * 1000

export function useFavoriteWorkflow(workflowId: string | null | undefined) {
  const { data, isLoading, error } = api.workflow.getById.useQuery(
    { id: workflowId! },
    { enabled: !!workflowId, staleTime: STALE_TIME, refetchOnWindowFocus: false }
  )
  const code = error?.data?.code
  const isNotFound = code === 'NOT_FOUND' || code === 'FORBIDDEN'
  return { workflow: data, isLoading, isNotFound }
}
