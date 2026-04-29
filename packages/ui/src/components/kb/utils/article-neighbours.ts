// packages/ui/src/components/kb/utils/article-neighbours.ts

import {
  type ArticleTreeFields,
  buildArticleTree,
  flattenArticleTreePreservingChildren,
} from './article-tree'

interface ArticleNeighbourFields extends ArticleTreeFields {
  isCategory?: boolean
}

/**
 * Compute prev/next article in display order. Categories are skipped — pager
 * only navigates between linkable articles.
 */
export function getArticleNeighbours<T extends ArticleNeighbourFields>(
  articles: T[],
  activeId: string
): { prev?: T; next?: T } {
  const tree = buildArticleTree(articles)
  const flat = flattenArticleTreePreservingChildren(tree).filter((a) => !a.isCategory) as T[]
  const idx = flat.findIndex((a) => a.id === activeId)
  if (idx === -1) return {}
  return {
    prev: idx > 0 ? flat[idx - 1] : undefined,
    next: idx < flat.length - 1 ? flat[idx + 1] : undefined,
  }
}
