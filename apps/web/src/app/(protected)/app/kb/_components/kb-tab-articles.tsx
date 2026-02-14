// src/app/(protected)/app/kb/_components/kb-tab-articles.tsx

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { closestCorners, DndContext, DragOverlay } from '@dnd-kit/core'
import { restrictToVerticalAxis, restrictToWindowEdges } from '@dnd-kit/modifiers'
import { Loader2, Plus, Settings } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import ArticleTreeSection from './article-tree-section'
import { useKnowledgeBase } from './kb-context'
import type { Article } from './kb-sidebar'
import { useArticleMove } from './use-article-move'

interface KBTabArticlesProps {
  knowledgeBaseId: string
}

const KBTabArticles: React.FC<KBTabArticlesProps> = ({ knowledgeBaseId }) => {
  const pathname = usePathname()
  const {
    articles,
    addArticle,
    articleTree,
    isAddingArticle, // Use the centralized loading state
    isLoadingArticles,
  } = useKnowledgeBase()

  // Create a local storage key specific to this KB
  const storageKey = `kb-${knowledgeBaseId}-openStates`

  // Load the stored open states from localStorage on mount
  const [articleOpenStates, setArticleOpenStates] = useState<Record<string, boolean>>(() => {
    // Only run in browser
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(storageKey)
        return stored ? JSON.parse(stored) : {}
      } catch (e) {
        console.error('Failed to parse stored article states', e)
        return {}
      }
    }
    return {}
  })

  // Persist open states to localStorage when they change
  useEffect(() => {
    if (typeof window !== 'undefined' && Object.keys(articleOpenStates).length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(articleOpenStates))
    }
  }, [articleOpenStates, storageKey])

  const basePath = `/app/kb/${knowledgeBaseId}`

  const toggleArticleOpen = useCallback((articleId: string) => {
    setArticleOpenStates((prev) => ({ ...prev, [articleId]: !prev[articleId] }))
  }, [])

  // Use our enhanced useArticleMove hook with autoOpen functionality
  const {
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    activeArticle,
    dropTarget,
    sensors,
    isDraggingAny,
    articleTree: dndArticleTree,
  } = useArticleMove({
    knowledgeBaseId,
    articleOpenStates,
    setArticleOpenStates,
  })

  const sortableIds = useMemo(() => (articles || []).map((article) => article.id), [articles])

  // Find the active article based on pathname
  const findActiveArticle = useCallback(() => {
    if (!articles || articles.length === 0) return null

    // Extract slug from pathname (handles both editor and articles path formats)
    // Format: /app/kb/{knowledgeBaseId}/editor/~/{slug} or /app/kb/{knowledgeBaseId}/articles/{slug}
    const editorPrefix = `${basePath}/editor/~/`
    const articlesPrefix = `${basePath}/articles/`

    let slug = ''
    if (pathname.startsWith(editorPrefix)) {
      slug = pathname.slice(editorPrefix.length).split('?')[0]
    } else if (pathname.startsWith(articlesPrefix)) {
      slug = pathname.slice(articlesPrefix.length).split('?')[0]
    }

    if (!slug) return null

    // Find article matching this slug path
    return articles.find((article) => {
      // For top-level articles
      if (article.slug === slug && !article.parentId) return true

      // For nested articles, check if their full path matches
      const slugParts = slug.split('/')
      if (slugParts.length > 1 && slugParts[slugParts.length - 1] === article.slug) {
        // This might be it, validate by checking parent chain
        let current = article
        let pathMatches = true

        // Start from the end of the slug and work backwards
        for (let i = slugParts.length - 1; i >= 0; i--) {
          if (current.slug !== slugParts[i]) {
            pathMatches = false
            break
          }

          // Check parent (if we're not at the top level)
          if (i > 0) {
            const parent = articles.find((a) => a.id === current.parentId)
            if (!parent) {
              pathMatches = false
              break
            }
            current = parent
          }
        }

        return pathMatches
      }

      return false
    })
  }, [articles, pathname, basePath])

  // Expand parents of active article whenever pathname changes
  useEffect(() => {
    // Skip if no articles
    if (!articles || articles.length === 0) return

    const activeArticle = findActiveArticle()
    if (!activeArticle) return

    // Get all parents of this article
    const getParentIds = (article: Article): string[] => {
      const parents: string[] = []
      let currentId = article.parentId

      while (currentId) {
        parents.push(currentId)
        const parent = articles.find((a) => a.id === currentId)
        if (!parent) break
        currentId = parent.parentId
      }

      return parents
    }

    const parentIds = getParentIds(activeArticle)
    if (parentIds.length === 0) return

    // Expand all parents
    setArticleOpenStates((prev) => {
      const newState = { ...prev }
      parentIds.forEach((id) => {
        newState[id] = true
      })
      return newState
    })
  }, [articles, findActiveArticle])

  if (isLoadingArticles) {
    return (
      <div className='flex items-center justify-center py-8'>
        <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
      </div>
    )
  }

  if (articles?.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center p-8 text-center'>
        <p className='mb-4 text-muted-foreground'>No articles yet.</p>
        <Button
          variant='default'
          size='sm'
          className='gap-1'
          onClick={() => addArticle(null, 'root')}
          loading={isAddingArticle}>
          <Plus />
          Create First Article
        </Button>
      </div>
    )
  }

  return (
    <div className='relative space-y-1 p-1'>
      <div className='mb-1 flex items-center justify-between px-2'>
        <h3 className='text-xs font-medium uppercase text-muted-foreground'>Articles</h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='icon-sm' className='h-6 w-6' disabled={isAddingArticle}>
              <Plus />
              <span className='sr-only'>Add Page or Settings</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem disabled={isAddingArticle} onClick={() => addArticle(null, 'root')}>
              {isAddingArticle ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className='mr-2 h-4 w-4' /> Add Page
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`${basePath}/settings`}>
                <Settings className='mr-2 h-4 w-4' />
                KB Settings
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* DndContext with enhanced configuration */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}>
        {/* <SortableContext
          items={sortableIds}
          strategy={verticalListSortingStrategy}> */}
        <ArticleTreeSection
          articles={dndArticleTree || articleTree}
          basePath={basePath}
          articleOpenStates={articleOpenStates}
          toggleArticleOpen={toggleArticleOpen}
          knowledgeBaseId={knowledgeBaseId}
          dropTarget={dropTarget}
          isDraggingAny={isDraggingAny}
        />
        {/* </SortableContext> */}

        {/* Drag overlay with smooth animation */}
        <DragOverlay
          dropAnimation={{
            duration: 200,
            easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
          }}
          style={{ cursor: 'grabbing' }}>
          {activeArticle ? (
            <div
              className='pointer-events-none rounded-md border bg-background px-3 py-2 opacity-80 shadow-md'
              style={{ maxWidth: '280px' }}>
              <div className='flex items-center space-x-2'>
                <span className='shrink-0 text-muted-foreground'>
                  {activeArticle.isCategory ? '📁' : '📄'}
                </span>
                <span className='truncate font-medium'>
                  {activeArticle.emoji
                    ? `${activeArticle.emoji} ${activeArticle.title}`
                    : activeArticle.title || 'Untitled'}
                </span>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <div className='mt-2 px-2'>
        <Button
          className='w-full justify-start text-muted-foreground'
          variant='ghost'
          size='sm'
          disabled={isAddingArticle}
          onClick={() => addArticle(null, 'root')}>
          {isAddingArticle ? (
            <>
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              Creating...
            </>
          ) : (
            <>
              <Plus className='mr-2 h-4 w-4' /> Add Page
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

export default KBTabArticles
