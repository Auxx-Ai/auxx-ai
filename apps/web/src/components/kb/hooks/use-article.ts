// apps/web/src/components/kb/hooks/use-article.ts
'use client'

import { useShallow } from 'zustand/shallow'
import { type ArticleMeta, selectEffectiveArticle, useArticleStore } from '../store/article-store'

/**
 * Returns the effective metadata for a single article from the store.
 * Returns undefined if the article isn't loaded or has been optimistically deleted.
 */
export function useArticle(id: string | null | undefined): ArticleMeta | undefined {
  return useArticleStore(
    useShallow((state) => (id ? selectEffectiveArticle(state, id) : undefined))
  )
}
