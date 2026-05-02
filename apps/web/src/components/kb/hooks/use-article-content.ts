// apps/web/src/components/kb/hooks/use-article-content.ts
'use client'

import type { JSONContent } from '@tiptap/core'
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
  /** What the preview should render for the resolved mode. */
  previewTitle: string | null
  previewDescription: string | null
  previewExcerpt: string | null
  previewEmoji: string | null
  previewContent: string | null
  previewContentJson: JSONContent | null
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
  const draftContentJson = (data?.contentJson as JSONContent | null | undefined) ?? null
  const draftTitle = data?.title ?? null
  const draftDescription = data?.description ?? null
  const draftExcerpt = data?.excerpt ?? null
  const draftEmoji = data?.emoji ?? null
  const publishedTitle = data?.publishedTitle ?? null
  const publishedContent = data?.publishedContent ?? null
  const publishedContentJson =
    (data?.publishedContentJson as JSONContent | null | undefined) ?? null
  const hasPublishedVersion = !!data?.hasPublishedVersion

  let previewTitle: string | null = draftTitle
  let previewDescription: string | null = draftDescription
  let previewExcerpt: string | null = draftExcerpt
  let previewEmoji: string | null = draftEmoji
  let previewContent: string | null = draftContent
  let previewContentJson: JSONContent | null = draftContentJson
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
        (v.selectedContentJson as JSONContent | null | undefined) ?? draftContentJson
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
    publishedTitle,
    publishedContent,
    publishedContentJson,
    hasPublishedVersion,
    hasUnpublishedChanges: !!data?.hasUnpublishedChanges,
    previewTitle,
    previewDescription,
    previewExcerpt,
    previewEmoji,
    previewContent,
    previewContentJson,
    previewVersionNumber,
    fellBackToDraft,
    isLoading: baseQuery.isLoading || (isHistorical && versionQuery.isLoading),
  }
}
