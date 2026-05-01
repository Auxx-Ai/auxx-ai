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
import { findFirstNavigableUnder, getFullSlugPath } from '@auxx/ui/components/kb/utils'
import { cn } from '@auxx/ui/lib/utils'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { restrictToVerticalAxis, restrictToWindowEdges } from '@dnd-kit/modifiers'
import { Archive, FileText, FolderClosed, Heading, Loader2, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useActiveArticle } from '../../hooks/use-active-article'
import { useArticleList, useIsArticleListLoaded } from '../../hooks/use-article-list'
import { useArticleMove } from '../../hooks/use-article-move'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleMeta, ArticleTreeNode } from '../../store/article-store'
import { usePendingInsertStore } from '../../store/pending-insert-store'
import { inferCreateParent } from '../../utils/infer-create-parent'
import { ArticleSidebarItemPreview } from './article-sidebar-item'
import { ArticleTreeSection } from './article-tree-section'
import { KBTabStrip } from './kb-tab-strip'

interface KBArticlesPanelProps {
  knowledgeBaseId: string
}

/**
 * Walks `parentId` recursively and returns a depth-first list of descendants
 * sorted by `sortOrder`. Used for the drag preview so dragging a header shows
 * the whole group, not just its label.
 */
function collectDescendants(parentId: string, all: ArticleMeta[]): ArticleMeta[] {
  const out: ArticleMeta[] = []
  const direct = all
    .filter((a) => a.parentId === parentId)
    .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0))
  for (const child of direct) {
    out.push(child)
    out.push(...collectDescendants(child.id, all))
  }
  return out
}

export function KBArticlesPanel({ knowledgeBaseId }: KBArticlesPanelProps) {
  const router = useRouter()

  const articles = useArticleList(knowledgeBaseId)
  const activeArticle = useActiveArticle(knowledgeBaseId)
  const hasLoaded = useIsArticleListLoaded(knowledgeBaseId)
  const { isCreating } = useArticleMutations(knowledgeBaseId)
  const setPending = usePendingInsertStore((s) => s.setPending)
  const clearPending = usePendingInsertStore((s) => s.clearPending)
  const pending = usePendingInsertStore((s) => s.pending)

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

  const {
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    activeArticle: draggingArticle,
    sensors,
    articleTree,
    collisionDetection,
  } = useArticleMove({ knowledgeBaseId, articleOpenStates, setArticleOpenStates })

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

  // Auto-expand parents of the active article whenever pathname changes.
  useEffect(() => {
    if (!articles || articles.length === 0) return
    if (!activeArticle) return

    const parentIds: string[] = []
    let cursor = activeArticle.parentId
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
  }, [articles, activeArticle])

  // Tabs are the structural root of the tree. Active tab is derived from the
  // URL's article (walk up to the enclosing tab) and falls back to the first
  // tab when nothing is selected.
  const tabs = useMemo(
    () =>
      articles
        .filter((a) => a.articleKind === ArticleKind.tab)
        .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0)),
    [articles]
  )

  const activeTabId = useMemo(() => {
    if (!activeArticle) return tabs[0]?.id ?? null
    let cursor: ArticleMeta | undefined = activeArticle
    while (cursor) {
      if (cursor.articleKind === ArticleKind.tab) return cursor.id
      if (!cursor.parentId) break
      cursor = articles.find((a) => a.id === cursor!.parentId)
    }
    return tabs[0]?.id ?? null
  }, [activeArticle, articles, tabs])

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
      const firstChild = findFirstNavigableUnder(tabId, articles)
      if (firstChild) {
        const slug = getFullSlugPath(firstChild, articles)
        router.push(`${basePath}/editor/~/${slug}?panel=articles`)
      }
    },
    [articles, basePath, router]
  )

  const handleCreateInTab = useCallback(
    (articleKind: ArticleKindType = ArticleKind.page) => {
      // Tabs are optional — `effectiveTabId === null` means the KB has zero
      // tabs and articles live at the root. Headers must sit directly at root
      // or under a tab; pages/categories drop into whatever section the user
      // is editing, falling back to the tab (or root).
      const parentId =
        articleKind === ArticleKind.header
          ? effectiveTabId
          : inferCreateParent(activeArticle, effectiveTabId, articles)
      setPending({ articleKind, parentId })
    },
    [effectiveTabId, activeArticle, articles, setPending]
  )

  // When a pending insert targets a closed category, expand it so the inline
  // create-row is visible. Also drop pending if the user switches tabs and
  // the target parent no longer lives under the active tab.
  useEffect(() => {
    if (!pending) return
    const { parentId } = pending
    if (parentId === null) return
    const parent = articles.find((a) => a.id === parentId)
    if (!parent) {
      clearPending()
      return
    }
    if (parent.articleKind === 'category') {
      setArticleOpenStates((prev) => (prev[parentId] ? prev : { ...prev, [parentId]: true }))
    }
  }, [pending, articles, clearPending])

  // Cancel pending when the active tab changes — the previous insertion point
  // is no longer on screen.
  useEffect(() => {
    if (!pending) return
    if (pending.parentId === null) return
    if (pending.parentId === effectiveTabId) return
    // Walk up from the pending parent to find its enclosing tab. If it's not
    // under the current tab, drop pending.
    let cursor = articles.find((a) => a.id === pending.parentId)
    while (cursor) {
      if (cursor.articleKind === ArticleKind.tab) {
        if (cursor.id !== effectiveTabId) clearPending()
        return
      }
      if (!cursor.parentId) return
      cursor = articles.find((a) => a.id === cursor!.parentId)
    }
  }, [effectiveTabId, pending, articles, clearPending])

  if (!hasLoaded) {
    return (
      <div className='flex items-center justify-center py-8'>
        <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative flex h-full flex-col gap-1 p-1',
        tabSubtree.length === 0 && 'flex-1'
      )}>
      <KBTabStrip
        knowledgeBaseId={knowledgeBaseId}
        activeTabId={effectiveTabId}
        onTabChange={handleTabChange}
      />
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}>
        <div
          className={cn(
            'flex flex-1 flex-col pt-3',
            tabSubtree.length === 0 && 'items-center justify-center'
          )}>
          <ArticleTreeSection
            articles={tabSubtree}
            knowledgeBaseId={knowledgeBaseId}
            parentId={effectiveTabId}
            articleOpenStates={articleOpenStates}
            toggleArticleOpen={toggleArticleOpen}
          />
          {tabSubtree.length === 0 && !(pending && pending.parentId === effectiveTabId) && (
            <div className='px-6 text-center text-base text-muted-foreground'>
              Nothing here yet.
              <br /> Add a{' '}
              <button
                type='button'
                onClick={() => void handleCreateInTab(ArticleKind.header)}
                disabled={isCreating}
                className='font-medium text-foreground underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50'>
                Section Header
              </button>{' '}
              or add a{' '}
              <button
                type='button'
                onClick={() => void handleCreateInTab(ArticleKind.page)}
                disabled={isCreating}
                className='font-medium text-foreground underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50'>
                Page
              </button>
              .
            </div>
          )}
        </div>

        <DragOverlay
          dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}
          style={{ cursor: 'grabbing' }}>
          {draggingArticle ? (
            <ArticleSidebarItemPreview
              article={draggingArticle}
              descendants={
                draggingArticle.articleKind === ArticleKind.header
                  ? collectDescendants(draggingArticle.id, articles)
                  : undefined
              }
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <div className='mt-2 px-2'>
        {tabSubtree.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className='w-full justify-start text-muted-foreground'
                variant='ghost'
                size='sm'
                disabled={isCreating}
                loading={isCreating}
                loadingText='Creating...'>
                <Plus /> Add
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='start'
              className='w-48'
              onCloseAutoFocus={(e) => e.preventDefault()}>
              <DropdownMenuItem onSelect={() => void handleCreateInTab(ArticleKind.page)}>
                <FileText /> Page
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleCreateInTab(ArticleKind.category)}>
                <FolderClosed /> Category
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleCreateInTab(ArticleKind.header)}>
                <Heading /> Section header
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {archivedCount > 0 && (
          <Button
            className='mt-1 w-full justify-start text-muted-foreground'
            variant='ghost'
            size='sm'
            onClick={() => setShowArchived((v) => !v)}>
            <Archive />
            {showArchived ? `Hide archived (${archivedCount})` : `Show archived (${archivedCount})`}
          </Button>
        )}
      </div>
    </div>
  )
}
