// apps/web/src/components/kb/ui/editor/hidden-parent-badge.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useArticleList } from '../../hooks/use-article-list'
import type { ArticleMeta } from '../../store/article-store'

interface HiddenParentBadgeProps {
  article: ArticleMeta
  knowledgeBaseId: string
}

/**
 * Warning badge surfaced when a published article has an ancestor that's hidden
 * (unpublished or archived). The public site filter drops descendants of hidden
 * ancestors, so the article is invisible to readers despite being marked
 * published.
 */
export function HiddenParentBadge({ article, knowledgeBaseId }: HiddenParentBadgeProps) {
  const articles = useArticleList(knowledgeBaseId)

  const hiddenAncestor = useMemo(() => {
    if (!article.isPublished) return undefined
    const byId = new Map(articles.map((a) => [a.id, a]))
    let cursor = article.parentId ? byId.get(article.parentId) : undefined
    while (cursor) {
      if (!cursor.isPublished || cursor.status === 'ARCHIVED') return cursor
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
    }
    return undefined
  }, [article, articles])

  if (!hiddenAncestor) return null

  const ancestorState = hiddenAncestor.status === 'ARCHIVED' ? 'archived' : 'unpublished'
  const message = `This article is published, but its parent “${hiddenAncestor.title}” is ${ancestorState}. Visitors won't see this article on the public site until the parent is restored.`

  return (
    <Tooltip content={message}>
      <Badge variant='amber'>
        <TriangleAlert />
        Parent hidden
      </Badge>
    </Tooltip>
  )
}
