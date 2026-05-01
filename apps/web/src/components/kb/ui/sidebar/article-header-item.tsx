// apps/web/src/components/kb/ui/sidebar/article-header-item.tsx
'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { cn } from '@auxx/ui/lib/utils'
import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleTreeNode } from '../../store/article-store'
import { ArticleInsertLine } from './article-insert-line'

interface ArticleHeaderItemProps {
  article: ArticleTreeNode
  knowledgeBaseId: string
}

/**
 * Section header rendered in the admin tree. Presentational label, but
 * draggable: a hover-reveal grip lets the author reorder the header (and
 * dropping another article above it places it as a sibling under the same
 * tab). Inline rename via double-click; 3-dot menu for delete.
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

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: article.id,
    data: { article, isCategory: false, type: 'header', dropPosition: 'inside' },
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    position: 'relative',
    zIndex: isDragging ? 10 : 1,
  }

  const { setNodeRef: topSetNodeRef, isOver: topIsOver } = useDroppable({
    id: `${article.id}-before`,
    data: { article, isCategory: false, dropArea: 'before', articleId: article.id },
  })

  return (
    <>
      <div className='relative'>
        <div ref={topSetNodeRef} className='absolute left-0 right-0 h-4 -top-1'>
          <div className={cn('h-1 bg-transparent', { 'bg-blue-500': topIsOver })} />
        </div>
        <div
          ref={setNodeRef}
          style={style}
          className={cn(
            'group/header relative flex items-center pb-1 pt-3',
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          )}>
          <div
            className='flex cursor-grab items-center px-1 opacity-0 group-hover/header:opacity-100'
            {...attributes}
            {...listeners}>
            <GripVertical className='size-3.5 text-muted-foreground' />
          </div>
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
                className='ml-1 mr-2 rounded-md p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100'>
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
          <ArticleInsertLine article={article} knowledgeBaseId={knowledgeBaseId} />
        </div>
      </div>
      <ConfirmDialog />
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
