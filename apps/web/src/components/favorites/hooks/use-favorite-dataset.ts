// apps/web/src/components/favorites/hooks/use-favorite-dataset.ts
'use client'

import { api } from '~/trpc/react'

const STALE_TIME = 5 * 60 * 1000

export function useFavoriteDataset(datasetId: string | null | undefined) {
  const { data, isLoading, error } = api.dataset.getById.useQuery(
    { id: datasetId! },
    { enabled: !!datasetId, staleTime: STALE_TIME, refetchOnWindowFocus: false }
  )
  const code = error?.data?.code
  const isNotFound = code === 'NOT_FOUND' || code === 'FORBIDDEN'
  return { dataset: data, isLoading, isNotFound }
}
