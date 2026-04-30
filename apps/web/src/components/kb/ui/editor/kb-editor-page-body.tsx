// apps/web/src/components/kb/ui/editor/kb-editor-page-body.tsx
'use client'

import { mergeDraftOverLive } from '@auxx/lib/kb/client'
import { findArticleBySlugPath } from '@auxx/ui/components/kb/utils'
import { useQueryState } from 'nuqs'
import { useMemo } from 'react'
import { LoadingSpinner } from '~/components/global/loading-content'
import { useArticleList, useIsArticleListLoaded } from '../../hooks/use-article-list'
import { useKnowledgeBase } from '../../hooks/use-knowledge-base'
import { KBPreview } from '../preview/kb-preview'
import { ArticleEditor } from './article-editor'

interface KBEditorPageBodyProps {
  knowledgeBaseId: string
  slug: string[]
}

/**
 * Right-pane content for the KB editor. Sits inside the editor route
 * segment layout (which owns the chrome + sidebar). Only this component
 * suspends on slug changes, so the sidebar stays mounted across article
 * navigations.
 */
export function KBEditorPageBody({ knowledgeBaseId, slug }: KBEditorPageBodyProps) {
  const [activeTab] = useQueryState('tab', { defaultValue: 'general' })
  const { knowledgeBase } = useKnowledgeBase(knowledgeBaseId)
  const hasArticlesLoaded = useIsArticleListLoaded(knowledgeBaseId)

  if (!knowledgeBase) return null

  if (activeTab !== 'articles') {
    return <KBPreview knowledgeBase={knowledgeBase} activeSlugPath={slug} />
  }

  return (
    <KBEditorBody
      knowledgeBaseId={knowledgeBaseId}
      slug={slug}
      hasArticlesLoaded={hasArticlesLoaded}
    />
  )
}

interface KBEditorBodyProps {
  knowledgeBaseId: string
  slug: string[]
  hasArticlesLoaded: boolean
}

function KBEditorBody({ knowledgeBaseId, slug, hasArticlesLoaded }: KBEditorBodyProps) {
  const articles = useArticleList(knowledgeBaseId)
  const { knowledgeBase } = useKnowledgeBase(knowledgeBaseId)

  const currentArticle = useMemo(() => {
    if (!articles || articles.length === 0 || !slug || slug.length === 0) return undefined
    return findArticleBySlugPath(articles, slug)
  }, [articles, slug])

  if (!hasArticlesLoaded) return <LoadingSpinner />

  if (currentArticle) {
    return <ArticleEditor article={currentArticle} knowledgeBaseId={knowledgeBaseId} />
  }

  const mergedName = knowledgeBase
    ? (mergeDraftOverLive(knowledgeBase as Record<string, unknown>) as typeof knowledgeBase).name
    : null
  return (
    <div className='p-8'>
      <h1 className='text-2xl font-bold'>{mergedName ?? 'No knowledge base'}</h1>
      <p className='mt-2 text-muted-foreground'>
        Select an article from the sidebar to edit, or create a new article.
      </p>
    </div>
  )
}
