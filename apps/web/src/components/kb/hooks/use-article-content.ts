// apps/web/src/components/kb/hooks/use-article-content.ts
'use client'

import type { JSONContent } from '@tiptap/core'
import { api } from '~/trpc/react'

interface UseArticleContentResult {
  content: string | null
  contentJson: JSONContent | null
  excerpt: string | null
  description: string | null
  isLoading: boolean
}

/**
 * Fetch an article's heavy content (HTML + JSON) directly from the server.
 * Content is intentionally not stored in the article store — only metadata is.
 */
export function useArticleContent(
  id: string | null | undefined,
  knowledgeBaseId: string | null | undefined
): UseArticleContentResult {
  const query = api.kb.getArticleById.useQuery(
    { id: id ?? '', knowledgeBaseId: knowledgeBaseId ?? undefined },
    { enabled: !!id && !!knowledgeBaseId }
  )

  return {
    content: query.data?.content ?? null,
    contentJson: (query.data?.contentJson as JSONContent | null | undefined) ?? null,
    excerpt: query.data?.excerpt ?? null,
    description: query.data?.description ?? null,
    isLoading: query.isLoading,
  }
}
