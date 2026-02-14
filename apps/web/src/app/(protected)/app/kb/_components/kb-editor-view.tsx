// app/kb/[knowledgeBaseId]/editor/[...slug]/page.tsx
'use client'

// import { KnowledgeBaseSidebar } from '~/components/knowledge-base/knowledge-base-sidebar'
// import { KnowledgeBaseProvider } from '~/components/knowledge-base/knowledge-base-context'
// import { ArticleEditor } from '~/components/knowledge-base/article-editor'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { keepPreviousData } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '~/trpc/react'
import ArticleEditor from './article-editor'
import { buildArticleTree, findArticleBySlugPath } from './helpers'
import { KBProvider } from './kb-context'
import { KBSidebar } from './kb-sidebar'
// import { EditorProvider } from '~/components/blocksuite/editor-provider'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'

type KBEditorParams = {
  knowledgeBaseId: string
  slug: string[]
  // params: Promise<{ knowledgeBaseId: string; slug: string[] }>
}

export default function KBEditorView({ knowledgeBaseId, slug }: KBEditorParams) {
  // const { knowledgeBaseId, slug } = await params
  // Parse the article slug from the route segments
  // const articleSlug = useMemo(() => slug.join('/'), [slug])
  const articleSlug = useMemo(() => {
    if (!slug || slug.length === 0) return ''
    return slug.join('/')
  }, [slug])

  // Fetch knowledge base data
  const { data: knowledgeBase, isLoading: isLoadingKb } = api.kb.byId.useQuery(
    { id: knowledgeBaseId },
    { enabled: !!knowledgeBaseId, placeholderData: keepPreviousData }
  )

  // Fetch all articles
  const { data: flatArticles, isLoading: isLoadingArticles } = api.kb.getArticles.useQuery(
    { knowledgeBaseId: knowledgeBaseId, includeUnpublished: true },
    { enabled: !!knowledgeBaseId, placeholderData: keepPreviousData }
  )

  // Fetch the current article
  // const { data: currentArticle, isLoading: isLoadingArticle } =
  //   api.kb.getArticleBySlug.useQuery(
  //     { slug: articleSlug, knowledgeBaseId: knowledgeBaseId },
  //     {
  //       // Only fetch if we have a slug and it's not the root
  //       enabled: !!knowledgeBaseId && !!articleSlug && slug.length > 0,
  //     }
  //   )

  const isLoading = isLoadingKb || isLoadingArticles

  // --- Build the tree structure from the flat list ---
  const articlesTree = useMemo(() => {
    if (!flatArticles) return [] // Return empty array if no data
    // console.log('Building tree in editor page...')
    return buildArticleTree(flatArticles) // Use the helper
  }, [flatArticles]) // Depends only on the flat list

  // --- Find the current article using the TREE ---
  const currentArticle = useMemo(() => {
    // Check if tree is built and slug exists
    if (!flatArticles || flatArticles.length === 0 || !slug || slug.length === 0) {
      return undefined
    }
    // console.log('Searching for article with slug path:', slug)
    // Pass the BUILT TREE to the search function
    return findArticleBySlugPath(flatArticles, slug)
  }, [flatArticles, slug]) // Depends on the built tree and the slug path

  // const currentArticle = useMemo(() => {
  //   if (!articles || !slug || slug.length === 0) {
  //     return undefined
  //   }
  //   return findArticleBySlugPath(articles, slug)
  // }, [articles, slug])

  if (isLoading) {
    console.log('Loading knowledge base or articles...')
    return (
      <div className='p-8'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='mt-4 h-4 w-full' />
        <Skeleton className='mt-2 h-4 w-full' />
      </div>
    )
  }

  // --- Not Found State (after loading) ---
  // Check if we expected an article (slug exists) but didn't find one
  if (slug && slug.length > 0 && !currentArticle) {
    console.log(`Article not found for slug path: ${slug.join('/')}`)
    // You might want to check if flatArticles is empty or null here too
    return <div className='p-8'>Article not found</div>
  }

  // if (!knowledgeBase || !articles) {
  //   return <div className='p-8'>Knowledge base not found</div>
  // }

  return (
    // <EditorProvider>
    <KBProvider knowledgeBaseId={knowledgeBaseId} initialArticles={flatArticles || []}>
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem
              title='Knowledge base '
              href={`/app/kb/${knowledgeBaseId}/editor/general`}
            />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          {/* Left sidebar */}
          <KBSidebar knowledgeBaseId={knowledgeBaseId} />

          {/* Main content */}
          <div className='flex min-h-0 max-lg:shrink-0 lg:flex-1'>
            {!slug || slug.length === 0 ? (
              // Root page - show dashboard
              <div className='p-8'>
                <h1 className='text-2xl font-bold'>
                  {knowledgeBase ? knowledgeBase.name : 'No knowledge base'}
                </h1>
                <p className='mt-2 text-muted-foreground'>
                  Select an article from the sidebar to edit, or create a new article.
                </p>

                {/* Article stats, quick actions, etc. */}
              </div>
            ) : currentArticle ? (
              <ArticleEditor article={currentArticle} knowledgeBaseId={knowledgeBaseId} />
            ) : (
              <div className='p-8'>Article not found</div>
            )}
          </div>
        </MainPageContent>
      </MainPage>
    </KBProvider>
    // </EditorProvider>
  )
}
