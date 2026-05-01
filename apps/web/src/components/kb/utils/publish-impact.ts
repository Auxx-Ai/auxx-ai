// apps/web/src/components/kb/utils/publish-impact.ts

import { ArticleKind, ArticleStatus } from '@auxx/database/enums'
import type { ArticleMeta } from '../store/article-store'

interface UnpublishedAncestorsResult {
  /** DRAFT ancestors of `id`, root-first. Empty when nothing needs cascading. */
  ancestors: ArticleMeta[]
  /**
   * First ARCHIVED ancestor walked. When set, the cascade is blocked — caller
   * should surface an error instead of opening the confirm dialog.
   */
  archivedAncestor: ArticleMeta | null
}

/**
 * Walk parentId chain from `id`. Collects DRAFT ancestors (root-first). Stops
 * on PUBLISHED. Bails with `archivedAncestor` set on the first ARCHIVED hit —
 * cascading through an archive would silently un-archive it.
 *
 * Used by both the publish-cascade dialog (full list) and HiddenParentBadge
 * (first-hit display).
 */
export function getUnpublishedAncestors(
  id: string,
  articles: ArticleMeta[]
): UnpublishedAncestorsResult {
  const byId = new Map(articles.map((a) => [a.id, a]))
  const start = byId.get(id)
  const stack: ArticleMeta[] = []
  let cursor = start?.parentId ? byId.get(start.parentId) : undefined
  while (cursor) {
    if (cursor.status === ArticleStatus.ARCHIVED) {
      return { ancestors: stack.reverse(), archivedAncestor: cursor }
    }
    if (cursor.isPublished) break
    stack.push(cursor)
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
  }
  return { ancestors: stack.reverse(), archivedAncestor: null }
}

/**
 * Count of currently-published descendants of `id` (any depth). Used by the
 * unpublish-impact prompt on tabs/headers to warn about hidden articles.
 */
export function countPublishedDescendants(id: string, articles: ArticleMeta[]): number {
  let count = 0
  const queue: string[] = [id]
  while (queue.length > 0) {
    const parentId = queue.shift()
    for (const a of articles) {
      if (a.parentId !== parentId) continue
      if (
        a.isPublished &&
        a.articleKind !== ArticleKind.tab &&
        a.articleKind !== ArticleKind.header
      ) {
        count++
      }
      queue.push(a.id)
    }
  }
  return count
}
