// apps/web/src/components/kb/ui/sidebar/kb-articles-panel.tsx
'use client'

import { ArticleKind } from '@auxx/database/enums'
import type { ArticleKind as ArticleKindType } from '@auxx/database/types'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { EntityIcon, getIcon } from '@auxx/ui/components/icons'
import { getFullSlugPath } from '@auxx/ui/components/kb/utils'
import { closestCorners, DndContext, DragOverlay } from '@dnd-kit/core'
import { restrictToVerticalAxis, restrictToWindowEdges } from '@dnd-kit/modifiers'
import { Archive, FileText, FolderClosed, Heading, Loader2, Plus } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useArticleList, useIsArticleListLoaded } from '../../hooks/use-article-list'
import { useArticleMove } from '../../hooks/use-article-move'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleMeta, ArticleTreeNode } from '../../store/article-store'
import { ArticleTreeSection } from './article-tree-section'
import { KBTabStrip } from './kb-tab-strip'

interface KBArticlesPanelProps {
  knowledgeBaseId: string
}

export function KBArticlesPanel({ knowledgeBaseId }: KBArticlesPanelProps) {
  const pathname = usePathname() ?? ''
  const router = useRouter()

  const articles = useArticleList(knowledgeBaseId)
  const hasLoaded = useIsArticleListLoaded(knowledgeBaseId)
  const { createArticle, isCreating } = useArticleMutations(knowledgeBaseId)

  const archivedKey = `kb-${knowledgeBaseId}-show-archived`
  const [showArchived, setShowArchived] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(archivedKey) === 'true'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(archivedKey, showArchived ? 'true' : 'false')
  }, [showArchived, archivedKey])

  const storageKey = `kb-${knowledgeBaseId}-openStates`
  const [articleOpenStates, setArticleOpenStates] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      const stored = localStorage.getItem(storageKey)
      return stored ? JSON.parse(stored) : {}
    } catch {
      return {}
    }
  })

  useEffect(() => {
    if (typeof window !== 'undefined' && Object.keys(articleOpenStates).length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(articleOpenStates))
    }
  }, [articleOpenStates, storageKey])

  const basePath = `/app/kb/${knowledgeBaseId}`

  const toggleArticleOpen = useCallback((articleId: string) => {
    setArticleOpenStates((prev) => ({ ...prev, [articleId]: !prev[articleId] }))
  }, [])

  const { handleDragStart, handleDragOver, handleDragEnd, activeArticle, sensors, articleTree } =
    useArticleMove({ knowledgeBaseId, articleOpenStates, setArticleOpenStates })

  const archivedCount = useMemo(
    () => articles.filter((a) => a.status === 'ARCHIVED').length,
    [articles]
  )

  const visibleTree = useMemo(() => {
    if (showArchived) return articleTree
    const stripArchived = (nodes: ArticleTreeNode[]): ArticleTreeNode[] =>
      nodes
        .filter((n) => n.status !== 'ARCHIVED')
        .map((n) => ({ ...n, children: stripArchived(n.children ?? []) }))
    return stripArchived(articleTree)
  }, [articleTree, showArchived])

  // Find the article matching the current pathname so we can expand its parents.
  const findActiveArticle = useCallback((): ArticleMeta | undefined => {
    if (!articles || articles.length === 0) return undefined
    const editorPrefix = `${basePath}/editor/~/`
    const articlesPrefix = `${basePath}/articles/`
    let slug = ''
    if (pathname.startsWith(editorPrefix)) {
      slug = pathname.slice(editorPrefix.length).split('?')[0]
    } else if (pathname.startsWith(articlesPrefix)) {
      slug = pathname.slice(articlesPrefix.length).split('?')[0]
    }
    if (!slug) return undefined
    const slugParts = slug.split('/')
    return articles.find((article) => {
      if (article.slug === slug && !article.parentId) return true
      if (slugParts.length > 1 && slugParts[slugParts.length - 1] === article.slug) {
        let cursor: ArticleMeta | undefined = article
        for (let i = slugParts.length - 1; i >= 0; i--) {
          if (!cursor || cursor.slug !== slugParts[i]) return false
          if (i > 0) {
            cursor = articles.find((a) => a.id === cursor!.parentId)
          }
        }
        return true
      }
      return false
    })
  }, [articles, pathname, basePath])

  // Auto-expand parents of the active article whenever pathname changes.
  useEffect(() => {
    if (!articles || articles.length === 0) return
    const active = findActiveArticle()
    if (!active) return

    const parentIds: string[] = []
    let cursor = active.parentId
    while (cursor) {
      parentIds.push(cursor)
      const parent = articles.find((a) => a.id === cursor)
      if (!parent) break
      cursor = parent.parentId
    }
    if (parentIds.length === 0) return

    setArticleOpenStates((prev) => {
      const next = { ...prev }
      for (const id of parentIds) next[id] = true
      return next
    })
  }, [articles, findActiveArticle])

  // Tabs are the structural root of the tree. Active tab is derived from the
  // URL's article (walk up to the enclosing tab) and falls back to the first
  // tab when nothing is selected.
  const tabs = useMemo(
    () =>
      articles.filter((a) => a.articleKind === ArticleKind.tab).sort((a, b) => a.order - b.order),
    [articles]
  )

  const activeTabId = useMemo(() => {
    const active = findActiveArticle()
    if (!active) return tabs[0]?.id ?? null
    let cursor: ArticleMeta | undefined = active
    while (cursor) {
      if (cursor.articleKind === ArticleKind.tab) return cursor.id
      if (!cursor.parentId) break
      cursor = articles.find((a) => a.id === cursor!.parentId)
    }
    return tabs[0]?.id ?? null
  }, [findActiveArticle, articles, tabs])

  const [pendingTabId, setPendingTabId] = useState<string | null>(null)
  const effectiveTabId = pendingTabId ?? activeTabId
  // Drop the local override once the URL catches up to it.
  useEffect(() => {
    if (pendingTabId && pendingTabId === activeTabId) setPendingTabId(null)
  }, [pendingTabId, activeTabId])

  const tabSubtree = useMemo(() => {
    if (!effectiveTabId) return visibleTree
    const root = visibleTree.find((n) => n.id === effectiveTabId)
    return root?.children ?? []
  }, [visibleTree, effectiveTabId])

  const handleTabChange = useCallback(
    (tabId: string) => {
      setPendingTabId(tabId)
      const firstChild = articles
        .filter((a) => a.parentId === tabId && a.articleKind !== ArticleKind.header)
        .sort((a, b) => a.order - b.order)[0]
      if (firstChild) {
        const slug = getFullSlugPath(firstChild, articles)
        router.push(`${basePath}/editor/~/${slug}?panel=articles`)
      }
    },
    [articles, basePath, router]
  )

  const handleCreateInTab = useCallback(
    async (articleKind: ArticleKindType = ArticleKind.page) => {
      if (!effectiveTabId) return
      const created = await createArticle({ parentId: effectiveTabId, articleKind })
      if (created) {
        // Headers have no URL; stay where we are. Pages/categories navigate to
        // the new article so the editor opens it.
        if (articleKind !== ArticleKind.header) {
          const path = `${basePath}/editor/~/${getFullSlugPath(created, [...articles, created])}?panel=articles`
          router.push(path)
        }
      }
    },
    [effectiveTabId, articles, basePath, createArticle, router]
  )

  if (!hasLoaded) {
    return (
      <div className='flex items-center justify-center py-8'>
        <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
      </div>
    )
  }

  return (
    <div className='relative flex flex-col gap-1 p-1'>
      <KBTabStrip
        knowledgeBaseId={knowledgeBaseId}
        activeTabId={effectiveTabId}
        onTabChange={handleTabChange}
      />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}>
        <ArticleTreeSection
          articles={tabSubtree}
          knowledgeBaseId={knowledgeBaseId}
          articleOpenStates={articleOpenStates}
          toggleArticleOpen={toggleArticleOpen}
        />

        <DragOverlay
          dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}
          style={{ cursor: 'grabbing' }}>
          {activeArticle ? (
            <div
              className='pointer-events-none rounded-md border bg-background px-3 py-2 opacity-80 shadow-md'
              style={{ maxWidth: '280px' }}>
              <div className='flex items-center space-x-2'>
                <span className='shrink-0 text-muted-foreground'>
                  {activeArticle.emoji && getIcon(activeArticle.emoji) ? (
                    <EntityIcon iconId={activeArticle.emoji} variant='bare' size='sm' />
                  ) : activeArticle.articleKind === ArticleKind.category ? (
                    '📁'
                  ) : (
                    '📄'
                  )}
                </span>
                <span className='truncate font-medium'>{activeArticle.title || 'Untitled'}</span>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <div className='mt-2 px-2'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className='w-full justify-start text-muted-foreground'
              variant='ghost'
              size='sm'
              disabled={isCreating || !effectiveTabId}>
              {isCreating ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className='mr-2 h-4 w-4' /> Add
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' className='w-48'>
            <DropdownMenuItem onSelect={() => void handleCreateInTab(ArticleKind.page)}>
              <FileText className='mr-2 h-4 w-4' /> Page
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void handleCreateInTab(ArticleKind.category)}>
              <FolderClosed className='mr-2 h-4 w-4' /> Category
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void handleCreateInTab(ArticleKind.header)}>
              <Heading className='mr-2 h-4 w-4' /> Section header
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {archivedCount > 0 && (
          <Button
            className='mt-1 w-full justify-start text-muted-foreground'
            variant='ghost'
            size='sm'
            onClick={() => setShowArchived((v) => !v)}>
            <Archive className='mr-2 h-4 w-4' />
            {showArchived ? `Hide archived (${archivedCount})` : `Show archived (${archivedCount})`}
          </Button>
        )}
      </div>
    </div>
  )
}
