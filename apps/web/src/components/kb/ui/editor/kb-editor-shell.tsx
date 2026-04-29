// apps/web/src/components/kb/ui/editor/kb-editor-shell.tsx
'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useQueryState } from 'nuqs'
import { useMemo } from 'react'
import { useArticleList, useIsArticleListLoaded } from '../../hooks/use-article-list'
import { useKnowledgeBase } from '../../hooks/use-knowledge-base'
import { findArticleBySlugPath } from '../../utils/article-paths'
import { KBPreview } from '../preview/kb-preview'
import { KBSidebar } from '../sidebar/kb-sidebar'
import { ArticleEditor } from './article-editor'
import { ArticleEditorLoading } from './article-editor-loading'

interface KBEditorShellProps {
  knowledgeBaseId: string
  slug: string[]
}

/**
 * Top-level editor shell. Wraps the page in MainPage + sidebar and
 * renders either the article editor or the live preview based on `?tab`.
 */
export function KBEditorShell({ knowledgeBaseId, slug }: KBEditorShellProps) {
  const [activeTab] = useQueryState('tab', { defaultValue: 'general' })
  const { knowledgeBase, isLoading: isKBLoading } = useKnowledgeBase(knowledgeBaseId)
  const articles = useArticleList(knowledgeBaseId)
  const hasArticlesLoaded = useIsArticleListLoaded(knowledgeBaseId)

  if (isKBLoading || !knowledgeBase) {
    return (
      <div className='p-8'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='mt-4 h-4 w-full' />
        <Skeleton className='mt-2 h-4 w-full' />
      </div>
    )
  }

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem
            title='Knowledge base '
            href={`/app/kb/${knowledgeBaseId}/editor/general`}
            last
          />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <div className='flex flex-row w-full h-full'>
          <KBSidebar knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />

          <div className='flex min-h-0 max-lg:shrink-0 lg:flex-1'>
            {activeTab === 'articles' ? (
              <KBEditorBody
                knowledgeBaseId={knowledgeBaseId}
                slug={slug}
                hasArticlesLoaded={hasArticlesLoaded}
              />
            ) : (
              <KBPreview knowledgeBase={knowledgeBase} />
            )}
          </div>
        </div>
      </MainPageContent>
    </MainPage>
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

  if (!hasArticlesLoaded) return <ArticleEditorLoading />

  if (!slug || slug.length === 0) {
    return (
      <div className='p-8'>
        <h1 className='text-2xl font-bold'>
          {knowledgeBase ? knowledgeBase.name : 'No knowledge base'}
        </h1>
        <p className='mt-2 text-muted-foreground'>
          Select an article from the sidebar to edit, or create a new article.
        </p>
      </div>
    )
  }

  if (currentArticle) {
    return <ArticleEditor article={currentArticle} knowledgeBaseId={knowledgeBaseId} />
  }

  return (
    <div className='p-8'>
      <h2 className='text-xl font-semibold'>Article not found</h2>
      <p className='mt-2 text-muted-foreground'>
        The requested article could not be found. It may have been deleted or moved.
      </p>
    </div>
  )
}
