// apps/web/src/components/favorites/hooks/use-favorite-snippet.ts
'use client'

import { api } from '~/trpc/react'

const STALE_TIME = 5 * 60 * 1000

export function useFavoriteSnippet(snippetId: string | null | undefined) {
  const { data, isLoading, error } = api.snippet.byId.useQuery(
    { id: snippetId! },
    { enabled: !!snippetId, staleTime: STALE_TIME, refetchOnWindowFocus: false }
  )
  const code = error?.data?.code
  const isNotFound = code === 'NOT_FOUND' || code === 'FORBIDDEN'
  return { snippet: data, isLoading, isNotFound }
}
