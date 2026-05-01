// apps/web/src/components/kb/ui/sidebar/kb-tab-strip.tsx
'use client'

import { ArticleKind } from '@auxx/database/enums'
import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@auxx/ui/components/context-menu'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { closestCenter, DndContext, DragOverlay } from '@dnd-kit/core'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { EyeOff, Link2, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { useArticleList } from '../../hooks/use-article-list'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import { usePublishWithConfirm } from '../../hooks/use-publish-with-confirm'
import { useTabReorder } from '../../hooks/use-tab-reorder'
import type { ArticleMeta } from '../../store/article-store'
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
  const { sensors, activeTab, handleDragStart, handleDragEnd } = useTabReorder(knowledgeBaseId)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const tabIds = useMemo(() => tabs.map((t) => t.id), [tabs])

  const handleAddClick = useCallback(() => {
    if (pending || isCreating) return
    setPending(true)
  }, [pending, isCreating])

  const handleCommitPending = useCallback(
    async (title: string) => {
      setPending(false)
      const created = await createArticle({
        title,
        articleKind: ArticleKind.tab,
        parentId: null,
      })
      if (created) onTabChange(created.id)
    },
    [createArticle, onTabChange]
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
                  tabCount={tabs.length}
                />
              ))}
              {pending && (
                <div className='inline-flex shrink-0 items-center border-b-2 border-transparent px-3 py-2 text-sm'>
                  <TabTitleInput
                    initialValue=''
                    placeholder='Untitled'
                    onCommit={handleCommitPending}
                    onCancel={() => setPending(false)}
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
  tabCount: number
}

function TabPill({
  tab,
  active,
  isRenaming,
  onSelect,
  onStartRename,
  onFinishRename,
  knowledgeBaseId,
  tabCount,
}: TabPillProps) {
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
    if (tabCount <= 1) return
    const ok = await confirm({
      title: 'Delete tab?',
      description:
        'The tab and every article inside it will be removed. This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    await deleteArticle(tab.id)
  }, [confirm, deleteArticle, tab.id, tabCount])

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
              'group/tab relative inline-flex shrink-0 items-center border-b-2 border-transparent px-3 py-2 text-sm transition-colors',
              active
                ? 'border-primary font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}>
            {isRenaming ? (
              <TabTitleInput
                initialValue={tab.title}
                onCommit={handleRenameCommit}
                onCancel={onFinishRename}
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
          <ContextMenuItem onSelect={handleDelete} disabled={tabCount <= 1} variant='destructive'>
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

interface TabTitleInputProps {
  initialValue: string
  placeholder?: string
  /** Called with the trimmed value when it differs from initialValue and is non-empty. */
  onCommit: (trimmed: string) => void
  /** Called on Escape, or on blur/Enter when the value is empty or unchanged. */
  onCancel: () => void
}

function TabTitleInput({ initialValue, placeholder, onCommit, onCancel }: TabTitleInputProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<AutosizeInputRef>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const finish = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || trimmed === initialValue) {
      onCancel()
      return
    }
    onCommit(trimmed)
  }, [value, initialValue, onCommit, onCancel])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      finish()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <AutosizeInput
      ref={inputRef}
      value={value}
      placeholder={placeholder}
      minWidth={30}
      onChange={(e) => setValue(e.target.value)}
      onBlur={finish}
      onKeyDown={handleKeyDown}
      inputClassName='rounded-sm bg-background px-1 text-sm outline-none ring-1 ring-primary'
    />
  )
}
