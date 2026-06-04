// apps/web/src/components/kb/ui/sources/source-article-view.tsx
'use client'

import { FileText } from 'lucide-react'
import { parseAsString, useQueryState } from 'nuqs'
import { useArticleList } from '../../hooks/use-article-list'
import { ArticleEditor } from '../editor/article-editor'
import type { KnowledgeSource } from './sources-provider'

/**
 * Right pane of the source workspace. Reads the `?article` query param (set by the
 * Articles tab tree) and renders the shared `ArticleEditor` for the selected
 * article — source-managed articles render read-only there. With nothing
 * selected it shows an empty-state prompt.
 */
export function SourceArticleView({ source }: { source: KnowledgeSource }) {
  const [articleId] = useQueryState('article', parseAsString)
  const articles = useArticleList(source.ownedKnowledgeBaseId)
  const article = articleId ? articles.find((a) => a.id === articleId) : undefined

  if (!article) {
    return (
      <div className='flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center'>
        <FileText className='size-8 text-muted-foreground/60' />
        <p className='text-sm text-muted-foreground'>
          Select an article from the Articles tab to view it.
        </p>
      </div>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
      <ArticleEditor article={article} knowledgeBaseId={source.ownedKnowledgeBaseId} />
    </div>
  )
}
