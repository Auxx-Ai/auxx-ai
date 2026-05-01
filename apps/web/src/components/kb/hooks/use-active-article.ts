// apps/web/src/components/kb/hooks/use-active-article.ts
'use client'

import { findArticleBySlugPath } from '@auxx/ui/components/kb/utils'
import { usePathname } from 'next/navigation'
import { useMemo } from 'react'
import type { ArticleMeta } from '../store/article-store'
import { useArticleList } from './use-article-list'

/**
 * Resolve the article matching the current admin editor URL. Defers to the
 * shared `findArticleBySlugPath` so legacy URLs (pre header-in-slug) still
 * resolve via its lastSlug fallback — without that, creating a new article
 * while viewing a legacy URL infers the wrong parent.
 */
export function useActiveArticle(knowledgeBaseId: string): ArticleMeta | undefined {
  const pathname = usePathname() ?? ''
  const articles = useArticleList(knowledgeBaseId)

  return useMemo(() => {
    if (!articles || articles.length === 0) return undefined
    const basePath = `/app/kb/${knowledgeBaseId}`
    const editorPrefix = `${basePath}/editor/~/`
    const articlesPrefix = `${basePath}/articles/`
    let slug = ''
    if (pathname.startsWith(editorPrefix)) {
      slug = pathname.slice(editorPrefix.length).split('?')[0]
    } else if (pathname.startsWith(articlesPrefix)) {
      slug = pathname.slice(articlesPrefix.length).split('?')[0]
    }
    if (!slug) return undefined
    return findArticleBySlugPath(articles, slug.split('/'))
  }, [articles, knowledgeBaseId, pathname])
}
