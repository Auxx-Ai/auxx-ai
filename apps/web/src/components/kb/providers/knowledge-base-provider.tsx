// apps/web/src/components/kb/providers/knowledge-base-provider.tsx
'use client'

import { ArticleKind } from '@auxx/database/enums'
import type { ArticleKind as ArticleKindType } from '@auxx/database/types'
import type React from 'react'
import { useEffect } from 'react'
import { api } from '~/trpc/react'
import { type ArticleMeta, getArticleStoreState } from '../store/article-store'
import { getKnowledgeBaseStoreState, type KnowledgeBase } from '../store/knowledge-base-store'

interface KnowledgeBaseProviderProps {
  knowledgeBaseId: string
  children: React.ReactNode
}

/** Normalize a server article (from tRPC) into ArticleMeta. */
function normalize(server: any): ArticleMeta {
  return {
    id: server.id,
    knowledgeBaseId: server.knowledgeBaseId,
    title: server.title ?? '',
    slug: server.slug ?? '',
    emoji: server.emoji ?? null,
    parentId: server.parentId ?? null,
    articleKind: (server.articleKind ?? ArticleKind.page) as ArticleKindType,
    sortOrder: server.sortOrder ?? 'a0',
    isPublished: !!server.isPublished,
    status: server.status,
    description: server.description ?? null,
    excerpt: server.excerpt ?? null,
    hasUnpublishedChanges: !!server.hasUnpublishedChanges,
    publishedAt: server.publishedAt ? new Date(server.publishedAt) : null,
    publishedRevisionId: server.publishedRevisionId ?? null,
    draftRevisionId: server.draftRevisionId ?? null,
  }
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
        (articlesQuery.data as any[]).map(normalize)
      )
    }
  }, [articlesQuery.data, knowledgeBaseId])

  return <>{children}</>
}
