// apps/web/src/components/kb/hooks/use-active-tab.ts
'use client'

import { ArticleKind } from '@auxx/database/enums'
import { usePathname } from 'next/navigation'
import { useMemo } from 'react'
import type { ArticleMeta } from '../store/article-store'
import { useArticleList } from './use-article-list'

/**
 * Resolve the active tab for the admin editor. Walks the parent chain from the
 * article matching the current URL up to the enclosing tab, falling back to the
 * first tab in the KB when nothing is selected.
 */
export function useActiveTabId(knowledgeBaseId: string): string | null {
  const pathname = usePathname() ?? ''
  const articles = useArticleList(knowledgeBaseId)

  return useMemo(() => {
    const tabs = articles
      .filter((a) => a.articleKind === ArticleKind.tab)
      .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0))
    if (tabs.length === 0) return null

    const basePath = `/app/kb/${knowledgeBaseId}`
    const editorPrefix = `${basePath}/editor/~/`
    const articlesPrefix = `${basePath}/articles/`
    let slug = ''
    if (pathname.startsWith(editorPrefix)) {
      slug = pathname.slice(editorPrefix.length).split('?')[0]
    } else if (pathname.startsWith(articlesPrefix)) {
      slug = pathname.slice(articlesPrefix.length).split('?')[0]
    }

    let active: ArticleMeta | undefined
    if (slug) {
      const slugParts = slug.split('/')
      active = articles.find((article) => {
        if (article.slug === slug && !article.parentId) return true
        if (slugParts.length > 1 && slugParts[slugParts.length - 1] === article.slug) {
          let cursor: ArticleMeta | undefined = article
          for (let i = slugParts.length - 1; i >= 0; i--) {
            if (!cursor || cursor.slug !== slugParts[i]) return false
            if (i > 0) cursor = articles.find((a) => a.id === cursor!.parentId)
          }
          return true
        }
        return false
      })
    }

    if (!active) return tabs[0].id
    let cursor: ArticleMeta | undefined = active
    while (cursor) {
      if (cursor.articleKind === ArticleKind.tab) return cursor.id
      if (!cursor.parentId) break
      cursor = articles.find((a) => a.id === cursor!.parentId)
    }
    return tabs[0].id
  }, [articles, knowledgeBaseId, pathname])
}
