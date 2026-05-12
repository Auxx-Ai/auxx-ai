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
  draftTitle: string | null
  draftDescription: string | null
  draftExcerpt: string | null
  draftEmoji: string | null
  draftCoverImage: string | null
  /** MediaAsset id linked to the draft cover (FK), or null. */
  draftCoverImageId: string | null
  /** Last published version (null if never published). */
  publishedTitle: string | null
  publishedContent: string | null
  publishedContentJson: ArticleNodeJSON[] | null
  publishedCoverImage: string | null
  hasPublishedVersion: boolean
  hasUnpublishedChanges: boolean
  /** What the preview should render for the resolved mode. */
  previewTitle: string | null
  previewDescription: string | null
  previewExcerpt: string | null
  previewEmoji: string | null
  previewContent: string | null
  previewContentJson: ArticleNodeJSON[] | null
  previewCoverImage: string | null
  /** Resolved version number when mode is `'live'` or historical; null otherwise. */
  previewVersionNumber: number | null
  /** True when mode === 'live' but the article has no published revision. */
  fellBackToDraft: boolean
  isLoading: boolean
}

/**
 * Fetch an article's heavy content (HTML + JSON) directly from the server.
 * Content is intentionally not stored in the article store — only metadata is.
 *
 * Returns the draft (what the editor mutates), the published revision (used
 * to power "discard draft" preview comparisons in the settings dialog), and
 * a resolved preview slice for the requested `mode`. Historical versions
 * are fetched as a separate cache cell keyed by `versionNumber` and treated
 * as immutable (`staleTime: Infinity`).
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
  const draftTitle = data?.title ?? null
  const draftDescription = data?.description ?? null
  const draftExcerpt = data?.excerpt ?? null
  const draftEmoji = data?.emoji ?? null
  const draftCoverImage = data?.coverImage ?? null
  const draftCoverImageId = data?.coverImageId ?? null
  const publishedTitle = data?.publishedTitle ?? null
  const publishedContent = data?.publishedContent ?? null
  const publishedContentJson =
    (data?.publishedContentJson as ArticleNodeJSON[] | null | undefined) ?? null
  const publishedCoverImage = data?.publishedCoverImage ?? null
  const hasPublishedVersion = !!data?.hasPublishedVersion

  let previewTitle: string | null = draftTitle
  let previewDescription: string | null = draftDescription
  let previewExcerpt: string | null = draftExcerpt
  let previewEmoji: string | null = draftEmoji
  let previewContent: string | null = draftContent
  let previewContentJson: ArticleNodeJSON[] | null = draftContentJson
  // In historical mode the version query is separate from the base query, so
  // it lags one render behind when the user switches versions. Defaulting to
  // the draft cover here causes a flicker where the draft image flashes
  // before the version's image takes over — start at null instead.
  let previewCoverImage: string | null = isHistorical ? null : draftCoverImage
  let previewVersionNumber: number | null = null
  let fellBackToDraft = false

  if (mode === 'live') {
    if (hasPublishedVersion) {
      previewTitle = publishedTitle
      // The base query only returns published content + title — fall back to
      // draft fields for description/excerpt/emoji since they're not in the
      // editor view's published payload. Acceptable: the body is what
      // changes between versions; metadata diffs are rare.
      previewContent = publishedContent
      previewContentJson = publishedContentJson
      previewCoverImage = publishedCoverImage
      // versionNumber for the live revision isn't returned by the base query
      // either; the picker pulls it from getArticleVersions when needed.
    } else {
      fellBackToDraft = true
    }
  } else if (isHistorical) {
    const v = versionQuery.data
    if (v) {
      previewTitle = v.selectedTitle ?? draftTitle
      previewDescription = v.selectedDescription ?? draftDescription
      previewExcerpt = v.selectedExcerpt ?? draftExcerpt
      previewEmoji = v.selectedEmoji ?? draftEmoji
      previewContent = v.selectedContent ?? draftContent
      previewContentJson =
        (v.selectedContentJson as ArticleNodeJSON[] | null | undefined) ?? draftContentJson
      // No draft fallback for cover — if the historical snapshot has no cover,
      // show no cover. Inheriting from the draft would misrepresent the version.
      previewCoverImage = v.selectedCoverImage ?? null
      previewVersionNumber = v.selectedVersionNumber ?? requestedVersion ?? null
    }
  }

  return {
    draftContent,
    draftContentJson,
    draftTitle,
    draftDescription,
    draftExcerpt,
    draftEmoji,
    draftCoverImage,
    draftCoverImageId,
    publishedTitle,
    publishedContent,
    publishedContentJson,
    publishedCoverImage,
    hasPublishedVersion,
    hasUnpublishedChanges: !!data?.hasUnpublishedChanges,
    previewTitle,
    previewDescription,
    previewExcerpt,
    previewEmoji,
    previewContent,
    previewContentJson,
    previewCoverImage,
    previewVersionNumber,
    fellBackToDraft,
    isLoading: baseQuery.isLoading || (isHistorical && versionQuery.isLoading),
  }
}
