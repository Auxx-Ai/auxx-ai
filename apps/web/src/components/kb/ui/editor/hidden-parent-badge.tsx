// apps/web/src/components/kb/ui/editor/hidden-parent-badge.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useArticleList } from '../../hooks/use-article-list'
import type { ArticleMeta } from '../../store/article-store'
import { getUnpublishedAncestors } from '../../utils/publish-impact'

interface HiddenParentBadgeProps {
  article: ArticleMeta
  knowledgeBaseId: string
}

/**
 * Warning badge surfaced when a published article has an ancestor that's hidden
 * (unpublished or archived). The public site filter drops descendants of hidden
 * ancestors, so the article is invisible to readers despite being marked
 * published. Backstop for state divergence — the publish-cascade dialog should
 * keep this from firing in normal flows.
 */
export function HiddenParentBadge({ article, knowledgeBaseId }: HiddenParentBadgeProps) {
  const articles = useArticleList(knowledgeBaseId)

  const hiddenAncestor = useMemo(() => {
    if (!article.isPublished) return undefined
    const { ancestors, archivedAncestor } = getUnpublishedAncestors(article.id, articles)
    // Prefer the closest DRAFT ancestor (most actionable). Fall back to any
    // archived ancestor walking up — that's the only thing past the chain stop.
    return ancestors[ancestors.length - 1] ?? archivedAncestor
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
