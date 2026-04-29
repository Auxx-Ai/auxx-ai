// apps/web/src/components/kb/hooks/use-article-list.ts
'use client'

import { useMemo } from 'react'
import { type ArticleMeta, useArticleStore } from '../store/article-store'

const EMPTY: ArticleMeta[] = []

/**
 * Returns the effective flat list of articles for a KB.
 * Reactive to store changes; merges pending optimistic state on top of server state.
 *
 * Implementation note: composes the list via `useMemo` over stable slice selectors
 * rather than running the merge inside a single shallow-compared selector. The
 * merge produces fresh `{ ...server, ...pending }` objects, which would defeat
 * `useShallow`'s element-wise reference check and cause `useSyncExternalStore` to
 * see a different snapshot on every read.
 */
export function useArticleList(knowledgeBaseId: string | null | undefined): ArticleMeta[] {
  const ids = useArticleStore((state) =>
    knowledgeBaseId ? state.articleIdsByKb[knowledgeBaseId] : undefined
  )
  const articles = useArticleStore((state) => state.articles)
  const pendingUpdates = useArticleStore((state) => state.pendingUpdates)
  const optimisticDeleted = useArticleStore((state) => state.optimisticDeleted)
  const optimisticNewArticles = useArticleStore((state) => state.optimisticNewArticles)

  return useMemo(() => {
    if (!ids || ids.length === 0) return EMPTY
    const out: ArticleMeta[] = []
    for (const id of ids) {
      if (optimisticDeleted.has(id)) continue
      const optNew = optimisticNewArticles[id]
      if (optNew) {
        out.push(optNew)
        continue
      }
      const server = articles.get(id)
      if (!server) continue
      const pending = pendingUpdates[id]
      out.push(pending ? { ...server, ...pending.optimistic } : server)
    }
    return out
  }, [ids, articles, pendingUpdates, optimisticDeleted, optimisticNewArticles])
}

/** Whether the article list for a KB has been hydrated at least once. */
export function useIsArticleListLoaded(knowledgeBaseId: string | null | undefined): boolean {
  return useArticleStore((state) =>
    knowledgeBaseId ? state.loadedKbs.has(knowledgeBaseId) : false
  )
}
