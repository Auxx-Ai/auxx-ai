// apps/web/src/components/favorites/hooks/use-favorite-knowledge-base.ts
'use client'

import { useMemo } from 'react'
import { api } from '~/trpc/react'

const STALE_TIME = 5 * 60 * 1000

export function useFavoriteKnowledgeBase(knowledgeBaseId: string | null | undefined) {
  const { data, isLoading, error } = api.kb.list.useQuery(undefined, {
    enabled: !!knowledgeBaseId,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
  })

  const knowledgeBase = useMemo(
    () => (data ? data.find((kb) => kb.id === knowledgeBaseId) : undefined),
    [data, knowledgeBaseId]
  )

  const code = error?.data?.code
  const isNotFound =
    code === 'NOT_FOUND' || code === 'FORBIDDEN' || (!isLoading && !!data && !knowledgeBase)

  return { knowledgeBase, isLoading, isNotFound }
}
