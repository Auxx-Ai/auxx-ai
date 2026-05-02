// apps/web/src/components/kb/ui/articles/article-move-picker.tsx
'use client'

import { useMemo } from 'react'
import { useArticleList } from '../../hooks/use-article-list'
import { ArticlePicker } from './article-picker'

interface ArticleMovePickerProps {
  knowledgeBaseId: string
  /** Article being moved — excluded from valid destinations along with its descendants. */
  articleId: string
  /** Highlight the article's current parent. */
  currentParentId: string | null
  /** Called with the chosen parentId (a tab id, or a category id under a tab). */
  onPick: (parentId: string) => void
  onClose: () => void
}

export function ArticleMovePicker({
  knowledgeBaseId,
  articleId,
  currentParentId,
  onPick,
  onClose,
}: ArticleMovePickerProps) {
  const articles = useArticleList(knowledgeBaseId)

  // Self + descendants are never valid destinations.
  const forbiddenIds = useMemo(() => {
    const banned = new Set<string>([articleId])
    let added = true
    while (added) {
      added = false
      for (const a of articles) {
        if (a.parentId && banned.has(a.parentId) && !banned.has(a.id)) {
          banned.add(a.id)
          added = true
        }
      }
    }
    return banned
  }, [articles, articleId])

  return (
    <ArticlePicker
      knowledgeBaseId={knowledgeBaseId}
      allowedKinds={['tab', 'category']}
      drillableKinds={['tab']}
      forbiddenIds={forbiddenIds}
      showTopOfTab
      currentParentId={currentParentId}
      rootLabel='Move to'
      onPick={onPick}
      onClose={onClose}
    />
  )
}
