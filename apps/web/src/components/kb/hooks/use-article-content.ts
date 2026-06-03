// apps/web/src/components/kb/hooks/use-article-content.ts
'use client'

import type { ArticleNodeJSON } from '@auxx/ui/components/kb'
import { api } from '~/trpc/react'

/**
 * Which slice of an article the preview should render.
 * - `'draft'`: the in-progress draft revision (default).
 * - `'live'`: the currently published revision; falls back to draft when
 *   the article has no published revision.
 * - `{ versionNumber }`: a historical immutable snapshot.
 */
export type PreviewMode = 'draft' | 'live' | { versionNumber: number }

interface UseArticleContentResult {
  /** Draft revision content (what the editor writes to). */
  draftContent: string | null
  draftContentJson: ArticleNodeJSON[] | null
  /** Stable hash of the draft contentJson — used by the editor to dedupe inbound syncs. */
  draftContentHash: string | null
  /** Last published version's content body (null if never published). */
  publishedContent: string | null
  publishedContentJson: ArticleNodeJSON[] | null
  /** What the preview should render for the resolved mode. */
  previewContent: string | null
  previewContentJson: ArticleNodeJSON[] | null
  /**
   * Historical-mode-only metadata snapshot. Populated when `mode` is
   * `{ versionNumber }` from the secondary version query.
   */
  historicalTitle: string | null
  historicalDescription: string | null
  historicalExcerpt: string | null
  historicalEmoji: string | null
  historicalCoverImage: string | null
  /** Resolved version number when mode is historical; null otherwise. */
  previewVersionNumber: number | null
  /** true = Locked/source-owned (read-only editor). */
  managed: boolean
  /** Owning KnowledgeSource display name — for the "Managed by {source}" banner. */
  sourceName: string | null
  isLoading: boolean
}

/**
 * Fetch an article's heavy content (HTML + JSON) directly from the server.
 * Lightweight metadata (title/emoji/cover/description) lives on the article
 * store — read it from there, or compose it for the active preview mode with
 * `resolvePreviewMeta(article, mode)`. This hook is purely about content
 * slices and the historical-version snapshot.
 *
 * Historical versions are fetched as a separate cache cell keyed by
 * `versionNumber` and treated as immutable (`staleTime: Infinity`).
 */
export function useArticleContent(
  id: string | null | undefined,
  knowledgeBaseId: string | null | undefined,
  mode: PreviewMode = 'draft'
): UseArticleContentResult {
  const isHistorical = typeof mode === 'object' && mode !== null
  const requestedVersion = isHistorical ? mode.versionNumber : undefined

  const baseQuery = api.kb.getArticleById.useQuery(
    { id: id ?? '', knowledgeBaseId: knowledgeBaseId ?? undefined },
    { enabled: !!id && !!knowledgeBaseId }
  )

  const versionQuery = api.kb.getArticleById.useQuery(
    {
      id: id ?? '',
      knowledgeBaseId: knowledgeBaseId ?? undefined,
      versionNumber: requestedVersion,
    },
    {
      enabled: !!id && !!knowledgeBaseId && isHistorical,
      staleTime: Number.POSITIVE_INFINITY,
    }
  )

  const data = baseQuery.data
  const draftContent = data?.content ?? null
  const draftContentJson = (data?.contentJson as ArticleNodeJSON[] | null | undefined) ?? null
  const draftContentHash = data?.draftContentHash ?? null
  const publishedContent = data?.publishedContent ?? null
  const publishedContentJson =
    (data?.publishedContentJson as ArticleNodeJSON[] | null | undefined) ?? null
  const hasPublishedVersion = !!data?.hasPublishedVersion

  let previewContent: string | null = draftContent
  let previewContentJson: ArticleNodeJSON[] | null = draftContentJson
  let historicalTitle: string | null = null
  let historicalDescription: string | null = null
  let historicalExcerpt: string | null = null
  let historicalEmoji: string | null = null
  let historicalCoverImage: string | null = null
  let previewVersionNumber: number | null = null

  if (mode === 'live') {
    if (hasPublishedVersion) {
      previewContent = publishedContent
      previewContentJson = publishedContentJson
    }
  } else if (isHistorical) {
    const v = versionQuery.data
    if (v) {
      previewContent = v.selectedContent ?? draftContent
      previewContentJson =
        (v.selectedContentJson as ArticleNodeJSON[] | null | undefined) ?? draftContentJson
      historicalTitle = v.selectedTitle ?? null
      historicalDescription = v.selectedDescription ?? null
      historicalExcerpt = v.selectedExcerpt ?? null
      historicalEmoji = v.selectedEmoji ?? null
      // No draft fallback for cover — if the historical snapshot has no cover,
      // show no cover. Inheriting from the draft would misrepresent the version.
      historicalCoverImage = v.selectedCoverImage ?? null
      previewVersionNumber = v.selectedVersionNumber ?? requestedVersion ?? null
    }
  }

  return {
    draftContent,
    draftContentJson,
    draftContentHash,
    publishedContent,
    publishedContentJson,
    previewContent,
    previewContentJson,
    historicalTitle,
    historicalDescription,
    historicalExcerpt,
    historicalEmoji,
    historicalCoverImage,
    previewVersionNumber,
    managed: !!data?.managed,
    sourceName: data?.sourceName ?? null,
    isLoading: baseQuery.isLoading || (isHistorical && versionQuery.isLoading),
  }
}
