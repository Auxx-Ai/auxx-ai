// apps/web/src/components/kb/ui/sidebar/article-header-item.tsx
'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { cn } from '@auxx/ui/lib/utils'
import { MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleTreeNode } from '../../store/article-store'

interface ArticleHeaderItemProps {
  article: ArticleTreeNode
  knowledgeBaseId: string
}

/**
 * Section header rendered in the admin tree. Presentational by default — no
 * link, no drag — but reveals a 3-dot menu on hover for rename/delete. Title
 * edits inline via the same flow as tab rename.
 */
export function ArticleHeaderItem({ article, knowledgeBaseId }: ArticleHeaderItemProps) {
  const { renameArticle, deleteArticle } = useArticleMutations(knowledgeBaseId)
  const [confirm, ConfirmDialog] = useConfirm()
  const [isRenaming, setIsRenaming] = useState(false)

  const handleDelete = useCallback(async () => {
    const ok = await confirm({
      title: 'Delete section header?',
      description:
        article.children && article.children.length > 0
          ? 'The header will be removed. Articles grouped under it stay where they are.'
          : 'The header will be removed.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    await deleteArticle(article.id)
  }, [confirm, deleteArticle, article])

  return (
    <>
      <div className='group/header flex items-center px-2 pb-1 pt-3'>
        {isRenaming ? (
          <RenameInput
            initialTitle={article.title}
            articleId={article.id}
            onFinish={() => setIsRenaming(false)}
            renameArticle={renameArticle}
          />
        ) : (
          <button
            type='button'
            onDoubleClick={() => setIsRenaming(true)}
            className={cn(
              'flex-1 truncate text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground',
              'cursor-text'
            )}>
            {article.title || 'Untitled'}
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              aria-label='Header options'
              className='ml-1 rounded-md p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100'>
              <MoreVertical className='size-4' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-40'>
            <DropdownMenuItem onSelect={() => setIsRenaming(true)}>
              <Pencil className='mr-2 size-4' /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleDelete} variant='destructive'>
              <Trash2 className='mr-2 size-4' /> Delete header
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {ConfirmDialog}
    </>
  )
}

interface RenameInputProps {
  initialTitle: string
  articleId: string
  onFinish: () => void
  renameArticle: (
    id: string,
    fields: { title?: string; emoji?: string | null; slug?: string }
  ) => Promise<void>
}

function RenameInput({ initialTitle, articleId, onFinish, renameArticle }: RenameInputProps) {
  const [value, setValue] = useState(initialTitle)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const commit = useCallback(async () => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== initialTitle) {
      await renameArticle(articleId, { title: trimmed })
    }
    onFinish()
  }, [value, initialTitle, articleId, renameArticle, onFinish])

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
      className='flex-1 rounded-sm bg-background px-1 text-xs font-semibold uppercase tracking-wide outline-none ring-1 ring-primary'
    />
  )
}
