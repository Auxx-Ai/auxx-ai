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
import { useEffect, useMemo } from 'react'
import { api } from '~/trpc/react'
import ArticleEditor from './article-editor'
import ArticleEditorLoading from './article-editor-loading'
import { findArticleBySlugPath } from './helpers'
import { KBProvider, useKnowledgeBase } from './kb-context'
import KBPreview from './kb-preview'
import { KBSidebar } from './kb-sidebar'

type KBEditorParams = { knowledgeBaseId: string; slug: string[] }

// Inner component that uses the KB context
// The main component that sets up the provider
export default function KBEditorView({ knowledgeBaseId, slug }: KBEditorParams) {
  const [activeTab, setActiveTab] = useQueryState('tab', { defaultValue: 'general' })

  // Fetch all articles for initial data
  const { data: flatArticles, isLoading: isLoadingArticles } = api.kb.getArticles.useQuery(
    { knowledgeBaseId, includeUnpublished: true },
    { enabled: !!knowledgeBaseId }
  )

  const { data: knowledgeBase, isLoading: isKnowledgeBaseLoading } = api.kb.byId.useQuery(
    { id: knowledgeBaseId },
    { enabled: !!knowledgeBaseId }
  )

  if (isLoadingArticles || isKnowledgeBaseLoading) {
    return (
      <div className='p-8'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='mt-4 h-4 w-full' />
        <Skeleton className='mt-2 h-4 w-full' />
      </div>
    )
  }

  return (
    <KBProvider knowledgeBaseId={knowledgeBaseId} initialArticles={flatArticles || []}>
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

            {/* Main content */}
            <div className='flex min-h-0 max-lg:shrink-0 lg:flex-1'>
              {activeTab === 'articles' ? (
                <KBEditorContent
                  knowledgeBaseId={knowledgeBaseId}
                  knowledgeBase={knowledgeBase}
                  slug={slug}
                />
              ) : (
                <KBPreview knowledgeBase={knowledgeBase} />
              )}
            </div>
          </div>
        </MainPageContent>
      </MainPage>
    </KBProvider>
  )
}

const KBEditorContent = ({
  knowledgeBaseId,
  knowledgeBase,
  slug,
}: {
  knowledgeBaseId: string
  knowledgeBase: RouterOutputs['kb']['byId']
  slug: string[]
}) => {
  const { articles, isLoadingArticles, isEditorLoading, setIsEditorLoading } = useKnowledgeBase()

  // Parse the article slug from the route segments
  const articleSlug = useMemo(() => {
    if (!slug || slug.length === 0) return ''
    return slug.join('/')
  }, [slug])

  // Fetch knowledge base data
  // const { data: knowledgeBase, isLoading: isLoadingKb } = api.kb.byId.useQuery(
  //   { id: knowledgeBaseId },
  //   { enabled: !!knowledgeBaseId }
  // )

  const isLoading = isLoadingArticles

  // --- Find the current article ---
  const currentArticle = useMemo(() => {
    // Check if articles exist and slug exists
    if (!articles || articles.length === 0 || !slug || slug.length === 0) {
      return undefined
    }

    return findArticleBySlugPath(articles, slug)
  }, [articles, slug])

  // Effect to track loading state for editor transitions
  useEffect(() => {
    // Start with loading state when articles or slug changes
    if (slug && slug.length > 0) {
      setIsEditorLoading(true)
    }

    // When articles load and we have a slug, check if we should still be loading
    if (!isLoadingArticles && articles && slug && slug.length > 0) {
      // Give a small delay to ensure smooth transitions
      const timer = setTimeout(() => {
        setIsEditorLoading(false)
      }, 300)

      return () => clearTimeout(timer)
    }
  }, [isLoadingArticles, articles, slug, setIsEditorLoading])

  if (isLoading) {
    return (
      <div className='p-8'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='mt-4 h-4 w-full' />
        <Skeleton className='mt-2 h-4 w-full' />
      </div>
    )
  }

  // Dashboard view (no slug)
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

  // Editor with loading state
  if (isEditorLoading) {
    return <ArticleEditorLoading />
  }

  // Editor with article
  if (currentArticle) {
    return <ArticleEditor article={currentArticle} knowledgeBaseId={knowledgeBaseId} />
  }

  // Article not found
  return (
    <div className='p-8'>
      <h2 className='text-xl font-semibold'>Article not found</h2>
      <p className='mt-2 text-muted-foreground'>
        The requested article could not be found. It may have been deleted or moved.
      </p>
    </div>
  )
}
