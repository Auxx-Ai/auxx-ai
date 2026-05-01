// apps/web/src/components/kb/ui/sidebar/kb-tab-strip.tsx
'use client'

import { ArticleKind } from '@auxx/database/enums'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@auxx/ui/components/context-menu'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { generateKeyBetween } from '@auxx/utils'
import { closestCenter, DndContext, DragOverlay } from '@dnd-kit/core'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { EyeOff, Link2, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useArticleList } from '../../hooks/use-article-list'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import { usePublishWithConfirm } from '../../hooks/use-publish-with-confirm'
import { useTabReorder } from '../../hooks/use-tab-reorder'
import { type ArticleMeta, getArticleStoreState } from '../../store/article-store'
import { RenameInput } from './rename-input'
import { TabSlugDialog } from './tab-slug-dialog'

interface KBTabStripProps {
  knowledgeBaseId: string
  activeTabId: string | null
  onTabChange: (tabId: string) => void
}

/**
 * Horizontal tab strip rendered at the top of `KBArticlesPanel`. Click switches
 * tabs, double-click (or right-click → Rename) renames inline, the trailing
 * `+` adds a pending tab pill — the new tab only persists once the user
 * commits a non-empty title (Enter or blur). Escape/empty cancels.
 */
export function KBTabStrip({ knowledgeBaseId, activeTabId, onTabChange }: KBTabStripProps) {
  const articles = useArticleList(knowledgeBaseId)
  const tabs = useMemo(
    () =>
      articles
        .filter((a) => a.articleKind === 'tab')
        .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0)),
    [articles]
  )

  const { createArticle, isCreating } = useArticleMutations(knowledgeBaseId)
  const moveMutation = api.kb.moveArticle.useMutation()
  const utils = api.useUtils()
  const { sensors, activeTab, handleDragStart, handleDragEnd } = useTabReorder(knowledgeBaseId)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef<HTMLDivElement>(null)

  const tabIds = useMemo(() => tabs.map((t) => t.id), [tabs])

  useEffect(() => {
    if (!pending || !pendingRef.current) return
    const viewport = pendingRef.current.closest<HTMLElement>('[data-slot=scroll-area-viewport]')
    viewport?.scrollTo({ left: viewport.scrollWidth + 10, behavior: 'smooth' })
  }, [pending])

  const handleAddClick = useCallback(() => {
    if (pending || isCreating) return
    setPending(true)
  }, [pending, isCreating])

  const handleCommitPending = useCallback(
    async (title: string) => {
      setPending(false)
      // First tab in this KB? Adopt every existing root non-tab article into
      // the new tab so the user doesn't have to reorganize manually. The
      // snapshot is captured before the create call so concurrent additions
      // aren't pulled in. Best-effort loop: a mid-loop failure leaves the rest
      // at root and the user can drag/retry.
      const orphans =
        articles.filter((a) => a.articleKind === 'tab').length === 0
          ? articles
              .filter((a) => a.parentId === null && a.articleKind !== 'tab')
              .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0))
          : []

      const created = await createArticle({
        title,
        articleKind: ArticleKind.tab,
        parentId: null,
      })
      if (!created) return

      if (orphans.length > 0) {
        const store = getArticleStoreState()
        let prevKey: string | null = null
        for (const orphan of orphans) {
          try {
            const sortOrder = generateKeyBetween(prevKey, null)
            const move = { id: orphan.id, parentId: created.id, sortOrder }
            store.applyOptimisticMove(move)
            await moveMutation.mutateAsync({ knowledgeBaseId, ...move })
            store.confirmMove()
            prevKey = sortOrder
          } catch {
            store.rollbackMove()
          }
        }
        utils.kb.getArticles.invalidate({ knowledgeBaseId })
      }

      onTabChange(created.id)
    },
    [articles, createArticle, knowledgeBaseId, moveMutation, onTabChange, utils.kb.getArticles]
  )

  return (
    <div className='flex w-full items-center border-b border-border'>
      <ScrollArea
        orientation='horizontal'
        scrollbarClassName='h-0.5! mb-0!'
        className='flex-1 [&_[data-slot=scroll-area-viewport]]:overscroll-x-none'>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}>
          <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
            <div className='flex items-center gap-0.5'>
              {tabs.length === 0 && !pending ? (
                <button
                  type='button'
                  onClick={handleAddClick}
                  disabled={isCreating}
                  className='flex flex-1 items-center justify-center border-b-2 border-transparent py-2 text-sm text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
                  aria-label='Add first tab'>
                  Click to add tab
                </button>
              ) : (
                <>
                  {tabs.map((tab) => (
                    <TabPill
                      key={tab.id}
                      tab={tab}
                      active={activeTabId === tab.id}
                      isRenaming={renamingId === tab.id}
                      onSelect={() => onTabChange(tab.id)}
                      onStartRename={() => setRenamingId(tab.id)}
                      onFinishRename={() => setRenamingId(null)}
                      knowledgeBaseId={knowledgeBaseId}
                    />
                  ))}
                  {pending && (
                    <div
                      ref={pendingRef}
                      className='inline-flex shrink-0 items-center border-b-2 border-transparent px-1 py-2 text-sm'>
                      <RenameInput
                        initialValue=''
                        placeholder='Untitled'
                        onCommit={handleCommitPending}
                        onCancel={() => setPending(false)}
                        inputClassName='rounded-sm bg-background px-1 text-sm outline-none ring-1 ring-primary'
                      />
                    </div>
                  )}
                  <div className='sticky right-0 z-10 ml-auto shrink-0 bg-primary-50 pl-2 [mask-image:linear-gradient(to_right,transparent_0,black_8px,black_100%)]'>
                    <button
                      type='button'
                      onClick={handleAddClick}
                      disabled={pending || isCreating || !!activeTab}
                      className='flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
                      aria-label='Add tab'>
                      <Plus size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeTab && (
              <div className='inline-flex items-center border-b-2 border-primary bg-background px-3 py-2 text-sm font-medium text-foreground shadow-md'>
                {activeTab.title || 'Untitled'}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </ScrollArea>
    </div>
  )
}

interface TabPillProps {
  tab: ArticleMeta
  active: boolean
  isRenaming: boolean
  onSelect: () => void
  onStartRename: () => void
  onFinishRename: () => void
  knowledgeBaseId: string
}

function TabPill({
  tab,
  active,
  isRenaming,
  onSelect,
  onStartRename,
  onFinishRename,
  knowledgeBaseId,
}: TabPillProps) {
  const articles = useArticleList(knowledgeBaseId)
  const { renameArticle, deleteArticle } = useArticleMutations(knowledgeBaseId)
  const [confirm, ConfirmDialog] = useConfirm()
  const [slugOpen, setSlugOpen] = useState(false)
  const {
    requestPublish,
    requestUnpublish,
    ConfirmDialog: PublishConfirmDialog,
  } = usePublishWithConfirm(knowledgeBaseId)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  })

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  }

  const handleDelete = useCallback(async () => {
    const hasChildren = articles.some((a) => a.parentId === tab.id)
    const ok = await confirm({
      title: hasChildren ? `Delete '${tab.title || 'Untitled'}'?` : 'Delete tab?',
      description: hasChildren
        ? 'Articles in this tab will be moved to the knowledge base root. This action cannot be undone.'
        : 'The tab will be removed. This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    await deleteArticle(tab.id)
  }, [articles, confirm, deleteArticle, tab.id, tab.title])

  const handleRenameCommit = useCallback(
    (next: string) => {
      void renameArticle(tab.id, { title: next })
      onFinishRename()
    },
    [renameArticle, tab.id, onFinishRename]
  )

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={setNodeRef}
            style={sortableStyle}
            {...attributes}
            {...(isRenaming ? {} : listeners)}
            className={cn(
              'group/tab relative inline-flex shrink-0 items-center border-b-2 border-transparent py-2 text-sm transition-colors',
              isRenaming ? 'px-1.75' : 'px-3',
              active
                ? 'border-primary font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}>
            {isRenaming ? (
              <RenameInput
                initialValue={tab.title}
                onCommit={handleRenameCommit}
                onCancel={onFinishRename}
                inputClassName='rounded-sm bg-background px-1 text-sm outline-none ring-1 ring-primary'
              />
            ) : (
              <button type='button' onClick={onSelect} onDoubleClick={onStartRename}>
                {tab.title || 'Untitled'}
              </button>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenuItem onSelect={() => onStartRename()}>
            <Pencil /> Rename
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => setSlugOpen(true)}>
            <Link2 /> Update slug
          </ContextMenuItem>
          <ContextMenuSeparator />
          {tab.isPublished ? (
            <ContextMenuItem onSelect={() => requestUnpublish(tab)}>
              <EyeOff /> Unpublish
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onSelect={() => requestPublish(tab)}>
              <Send /> Publish
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleDelete} variant='destructive'>
            <Trash2 /> Delete tab
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <ConfirmDialog />
      <PublishConfirmDialog />
      <TabSlugDialog
        open={slugOpen}
        onOpenChange={setSlugOpen}
        tab={tab}
        knowledgeBaseId={knowledgeBaseId}
      />
    </>
  )
}
