// apps/web/src/components/kb/hooks/use-article-content.ts
'use client'

import type { JSONContent } from '@tiptap/core'
import { api } from '~/trpc/react'

interface UseArticleContentResult {
  /** Draft revision content (what the editor writes to). */
  draftContent: string | null
  draftContentJson: JSONContent | null
  draftTitle: string | null
  draftDescription: string | null
  draftExcerpt: string | null
  draftEmoji: string | null
  /** Last published version (null if never published). */
  publishedTitle: string | null
  publishedContent: string | null
  publishedContentJson: JSONContent | null
  hasPublishedVersion: boolean
  hasUnpublishedChanges: boolean
  isLoading: boolean
}

/**
 * Fetch an article's heavy content (HTML + JSON) directly from the server.
 * Content is intentionally not stored in the article store — only metadata is.
 *
 * Returns both the draft (what the editor mutates) and the published revision
 * (used to power "discard draft" preview comparisons in the settings dialog).
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
    draftContent: query.data?.content ?? null,
    draftContentJson: (query.data?.contentJson as JSONContent | null | undefined) ?? null,
    draftTitle: query.data?.title ?? null,
    draftDescription: query.data?.description ?? null,
    draftExcerpt: query.data?.excerpt ?? null,
    draftEmoji: query.data?.emoji ?? null,
    publishedTitle: query.data?.publishedTitle ?? null,
    publishedContent: query.data?.publishedContent ?? null,
    publishedContentJson:
      (query.data?.publishedContentJson as JSONContent | null | undefined) ?? null,
    hasPublishedVersion: !!query.data?.hasPublishedVersion,
    hasUnpublishedChanges: !!query.data?.hasUnpublishedChanges,
    isLoading: query.isLoading,
  }
}
