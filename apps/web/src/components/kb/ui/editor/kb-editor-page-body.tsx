// apps/web/src/components/kb/ui/editor/kb-editor-page-body.tsx
'use client'

import { ArticleKind } from '@auxx/database/enums'
import { mergeDraftOverLive } from '@auxx/lib/kb/client'
import { findArticleBySlugPath } from '@auxx/ui/components/kb/utils'
import { useQueryState } from 'nuqs'
import { useMemo } from 'react'
import { LoadingSpinner } from '~/components/global/loading-content'
import { useArticleList, useIsArticleListLoaded } from '../../hooks/use-article-list'
import { useDiffParam } from '../../hooks/use-diff-param'
import { useKnowledgeBase } from '../../hooks/use-knowledge-base'
import { KBPreview } from '../preview/kb-preview'
import { ArticleDiffPane } from './article-diff-pane'
import { ArticleEditor } from './article-editor'
import { ContainerArticlePlaceholder } from './container-article-placeholder'
import { useKBEditorAccess } from './kb-editor-access-context'

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
  const [activePanel] = useQueryState('panel', { defaultValue: 'general' })
  const { knowledgeBase } = useKnowledgeBase(knowledgeBaseId)
  const hasArticlesLoaded = useIsArticleListLoaded(knowledgeBaseId)
  const { canAdmin } = useKBEditorAccess()

  if (!knowledgeBase) return null

  // The learned KB ("AI Memory") has no site preview — always the editor. Nor
  // does an Edit-level (non-admin) member get the site preview even via a
  // stale `?panel=general` deep link — settings/layout are Full-only.
  if (activePanel !== 'articles' && knowledgeBase.kind !== 'learned' && canAdmin) {
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
  const [diffValue, setDiff] = useDiffParam()

  const currentArticle = useMemo(() => {
    if (!articles || articles.length === 0 || !slug || slug.length === 0) return undefined
    return findArticleBySlugPath(articles, slug)
  }, [articles, slug])

  if (!hasArticlesLoaded) return <LoadingSpinner />

  if (currentArticle) {
    const kind = currentArticle.articleKind
    if (kind === ArticleKind.tab || kind === ArticleKind.header || kind === ArticleKind.link) {
      return (
        <ContainerArticlePlaceholder article={currentArticle} knowledgeBaseId={knowledgeBaseId} />
      )
    }
    if (diffValue && knowledgeBase) {
      return (
        <ArticleDiffPane
          article={currentArticle}
          knowledgeBaseId={knowledgeBaseId}
          knowledgeBase={knowledgeBase}
          diffValue={diffValue}
          onClose={() => setDiff(null)}
        />
      )
    }
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
