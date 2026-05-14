// apps/web/src/components/favorites/hooks/use-favorite-article.ts
'use client'

import { getFullSlugPath } from '@auxx/ui/components/kb/utils'
import { useMemo } from 'react'
import { api } from '~/trpc/react'

const STALE_TIME = 5 * 60 * 1000

export function useFavoriteArticle(
  articleId: string | null | undefined,
  knowledgeBaseId: string | null | undefined
) {
  const enabled = !!articleId && !!knowledgeBaseId
  const { data, isLoading, error } = api.kb.getArticles.useQuery(
    { knowledgeBaseId: knowledgeBaseId!, includeUnpublished: true },
    { enabled, staleTime: STALE_TIME, refetchOnWindowFocus: false }
  )

  const article = useMemo(
    () => (data ? data.find((a) => a.id === articleId) : undefined),
    [data, articleId]
  )

  const slugPath = useMemo(() => {
    if (!article || !data) return ''
    return getFullSlugPath(article, data)
  }, [article, data])

  const code = error?.data?.code
  const isNotFound =
    code === 'NOT_FOUND' ||
    code === 'FORBIDDEN' ||
    (!isLoading && !!data && !article) ||
    !!(article && article.status === 'ARCHIVED')

  return { article, slugPath, isLoading, isNotFound }
}
