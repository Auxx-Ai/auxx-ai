// apps/web/src/components/kb/ui/preview/resolve-preview-meta.ts

import type { PreviewMode } from '../../hooks/use-article-content'
import type { ArticleMeta, ArticleRevisionMeta } from '../../store/article-store'

export interface ResolvedPreviewMeta {
  title: string
  description: string | null
  excerpt: string | null
  emoji: string | null
  coverImage: string | null
  /** True when mode === 'live' but the article has no published revision. */
  fellBackToDraft: boolean
}

/**
 * Pure resolver for draft/live preview metadata. Reads synchronously off the
 * article store envelopes — no async dependency, so flipping the topbar's
 * "Live" toggle swaps title/emoji/cover without waiting on a query.
 *
 * Historical (`{ versionNumber }`) mode is intentionally not handled here:
 * its metadata lives behind an async `getArticleById(..., versionNumber)`
 * query and `useArticleContent` returns it through a separate slot.
 */
export function resolvePreviewMeta(
  article: ArticleMeta,
  mode: Extract<PreviewMode, 'draft' | 'live'>
): ResolvedPreviewMeta {
  if (mode === 'live') {
    const pub: ArticleRevisionMeta | null = article.published
    if (pub) {
      return {
        title: pub.title,
        description: pub.description,
        excerpt: pub.excerpt,
        emoji: pub.emoji,
        coverImage: pub.coverImage,
        fellBackToDraft: false,
      }
    }
    return {
      title: article.draft.title,
      description: article.draft.description,
      excerpt: article.draft.excerpt,
      emoji: article.draft.emoji,
      coverImage: article.draft.coverImage,
      fellBackToDraft: true,
    }
  }
  return {
    title: article.draft.title,
    description: article.draft.description,
    excerpt: article.draft.excerpt,
    emoji: article.draft.emoji,
    coverImage: article.draft.coverImage,
    fellBackToDraft: false,
  }
}
