// apps/web/src/components/kb/providers/knowledge-base-provider.tsx
'use client'

import type React from 'react'
import { useEffect } from 'react'
import { useTagHierarchy } from '~/components/tags/hooks/use-tag-hierarchy'
import { api } from '~/trpc/react'
import { getArticleStoreState } from '../store/article-store'
import { getKnowledgeBaseStoreState, type KnowledgeBase } from '../store/knowledge-base-store'
import { normalizeServerArticle } from '../store/normalize-server-article'

interface KnowledgeBaseProviderProps {
  knowledgeBaseId: string
  children: React.ReactNode
}

/**
 * Hydrates the article store + knowledge-base store for the active KB.
 * Mount once per route. Articles for the previous KB are cleared on unmount.
 */
export function KnowledgeBaseProvider({ knowledgeBaseId, children }: KnowledgeBaseProviderProps) {
  // Hydrate the KB list (used by the switcher).
  const kbList = api.kb.list.useQuery(undefined, { staleTime: 5 * 60 * 1000 })
  useEffect(() => {
    if (kbList.data) {
      getKnowledgeBaseStoreState().setKnowledgeBases(kbList.data as KnowledgeBase[])
    }
  }, [kbList.data])

  // Track active KB id.
  useEffect(() => {
    getKnowledgeBaseStoreState().setActiveKnowledgeBaseId(knowledgeBaseId)
  }, [knowledgeBaseId])

  // Pre-populate the tag record store for article-scoped tags so TagBadge
  // chips render synchronously when the editor mounts. Side-effect only.
  useTagHierarchy({ scope: 'article' })

  // Hydrate articles for the active KB.
  // We intentionally do NOT clearKb on unmount: KBEditorPage suspends on
  // slug changes (the parent loading.tsx wraps it in a Suspense boundary),
  // so the provider remounts mid-navigation. Clearing here would race with
  // pending optimistic state and cause the just-confirmed article to flicker
  // out and back in. The store's setArticles is upsert-only and survives
  // stale fetches without leaking across KBs (articleIdsByKb is per-kb).
  const articlesQuery = api.kb.getArticles.useQuery(
    { knowledgeBaseId, includeUnpublished: true },
    { enabled: !!knowledgeBaseId }
  )
  useEffect(() => {
    if (articlesQuery.data) {
      getArticleStoreState().setArticles(
        knowledgeBaseId,
        (articlesQuery.data as any[]).map(normalizeServerArticle)
      )
    }
  }, [articlesQuery.data, knowledgeBaseId])

  return <>{children}</>
}
