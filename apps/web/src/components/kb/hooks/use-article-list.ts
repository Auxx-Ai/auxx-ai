// apps/web/src/components/kb/hooks/use-article-list.ts
'use client'

import { useShallow } from 'zustand/shallow'
import { type ArticleMeta, selectArticlesForKb, useArticleStore } from '../store/article-store'

const EMPTY: ArticleMeta[] = []

/**
 * Returns the effective flat list of articles for a KB.
 * Reactive to store changes via shallow equality on the resolved array.
 */
export function useArticleList(knowledgeBaseId: string | null | undefined): ArticleMeta[] {
  return useArticleStore(
    useShallow((state) => (knowledgeBaseId ? selectArticlesForKb(state, knowledgeBaseId) : EMPTY))
  )
}

/** Whether the article list for a KB has been hydrated at least once. */
export function useIsArticleListLoaded(knowledgeBaseId: string | null | undefined): boolean {
  return useArticleStore((state) =>
    knowledgeBaseId ? state.loadedKbs.has(knowledgeBaseId) : false
  )
}
