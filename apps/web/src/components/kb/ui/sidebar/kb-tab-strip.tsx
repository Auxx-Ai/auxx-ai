// apps/web/src/components/kb/ui/sidebar/kb-tab-strip.tsx
'use client'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@auxx/ui/components/context-menu'
import { EntityIcon, getIcon } from '@auxx/ui/components/icons'
import { cn } from '@auxx/ui/lib/utils'
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { useArticleList } from '../../hooks/use-article-list'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleMeta } from '../../store/article-store'
import { AddTabDialog } from '../articles/add-tab-dialog'

interface KBTabStripProps {
  knowledgeBaseId: string
  activeTabId: string | null
  onTabChange: (tabId: string) => void
}

/**
 * Horizontal tab strip rendered at the top of `KBArticlesPanel`. Click switches
 * tabs, double-click (or right-click → Rename) renames inline, the trailing
 * `+` opens the add-tab dialog.
 */
export function KBTabStrip({ knowledgeBaseId, activeTabId, onTabChange }: KBTabStripProps) {
  const articles = useArticleList(knowledgeBaseId)
  const tabs = useMemo(
    () => articles.filter((a) => a.articleKind === 'tab').sort((a, b) => a.order - b.order),
    [articles]
  )

  const [addOpen, setAddOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)

  return (
    <div className='flex w-full items-center gap-0.5 border-b border-border'>
      <div className='flex flex-1 items-center gap-0.5 overflow-x-auto'>
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
      </div>
      <button
        type='button'
        onClick={() => setAddOpen(true)}
        className='flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground'
        aria-label='Add tab'>
        <Plus size={14} />
      </button>
      <AddTabDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        knowledgeBaseId={knowledgeBaseId}
        onCreated={(id) => onTabChange(id)}
      />
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

  const hasIcon = !!tab.emoji && !!getIcon(tab.emoji)

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              'group/tab relative inline-flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm transition-colors',
              active
                ? 'border-primary font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}>
            {isRenaming ? (
              <RenameInput tab={tab} onFinish={onFinishRename} renameArticle={renameArticle} />
            ) : (
              <button
                type='button'
                onClick={onSelect}
                onDoubleClick={onStartRename}
                className='inline-flex items-center gap-1.5'>
                {hasIcon ? (
                  <EntityIcon iconId={tab.emoji as string} variant='bare' size='sm' />
                ) : (
                  <FileText size={14} className='opacity-60' />
                )}
                <span>{tab.title || 'Untitled'}</span>
              </button>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onStartRename()}>
            <Pencil className='mr-2 size-4' /> Rename
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleDelete} disabled={tabCount <= 1} variant='destructive'>
            <Trash2 className='mr-2 size-4' /> Delete tab
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {ConfirmDialog}
    </>
  )
}

interface RenameInputProps {
  tab: ArticleMeta
  onFinish: () => void
  renameArticle: (
    id: string,
    fields: { title?: string; emoji?: string | null; slug?: string }
  ) => Promise<void>
}

function RenameInput({ tab, onFinish, renameArticle }: RenameInputProps) {
  const [value, setValue] = useState(tab.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const commit = useCallback(async () => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== tab.title) {
      await renameArticle(tab.id, { title: trimmed })
    }
    onFinish()
  }, [value, tab.title, tab.id, renameArticle, onFinish])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onFinish()
    }
  }

  return (
    <input
      ref={inputRef}
      type='text'
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      className='w-32 rounded-sm bg-background px-1 text-sm outline-none ring-1 ring-primary'
    />
  )
}
