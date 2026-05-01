// apps/web/src/components/kb/hooks/use-active-tab.ts
'use client'

import { ArticleKind } from '@auxx/database/enums'
import type { ArticleMeta } from '../store/article-store'
import { useActiveArticle } from './use-active-article'
import { useArticleList } from './use-article-list'

/**
 * Resolve the active tab for the admin editor. Walks the parent chain from the
 * article matching the current URL up to the enclosing tab, falling back to the
 * first tab in the KB when nothing is selected.
 */
export function useActiveTabId(knowledgeBaseId: string): string | null {
  const articles = useArticleList(knowledgeBaseId)
  const active = useActiveArticle(knowledgeBaseId)

  const tabs = articles
    .filter((a) => a.articleKind === ArticleKind.tab)
    .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0))
  if (tabs.length === 0) return null

  if (!active) return tabs[0].id
  let cursor: ArticleMeta | undefined = active
  while (cursor) {
    if (cursor.articleKind === ArticleKind.tab) return cursor.id
    if (!cursor.parentId) break
    cursor = articles.find((a) => a.id === cursor!.parentId)
  }
  return tabs[0].id
}
