// apps/web/src/components/kb/ui/sidebar/article-sidebar-item.tsx
'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { cn } from '@auxx/ui/lib/utils'
import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  BookCopy,
  ChevronRight,
  EyeOff,
  Files,
  FileText,
  FolderClosed,
  FolderOpen,
  GripVertical,
  MoreVertical,
  Pencil,
  Trash2,
  TypeOutline,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useArticleList } from '../../hooks/use-article-list'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleTreeNode } from '../../store/article-store'
import { getArticleSlugPaths, getFullSlugPath, isArticleActive } from '../../utils/article-paths'
import { ArticleRenameDialog } from '../editor/article-rename-dialog'

interface ArticleSidebarItemProps {
  article: ArticleTreeNode
  knowledgeBaseId: string
  isOpen?: boolean
  onToggleOpen?: (articleId: string) => void
}

export function ArticleSidebarItem({
  article,
  knowledgeBaseId,
  isOpen = false,
  onToggleOpen,
}: ArticleSidebarItemProps) {
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const isCategory = article.isCategory || (article.children && article.children.length > 0)

  const articles = useArticleList(knowledgeBaseId)
  const { createArticle, deleteArticle, publishArticle, duplicateArticle, renameArticle } =
    useArticleMutations(knowledgeBaseId)

  const basePath = `/app/kb/${knowledgeBaseId}`
  const slugPaths = useMemo(() => getArticleSlugPaths(articles), [articles])
  const isActive = isArticleActive(article, pathname, basePath, slugPaths)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging, over, active } =
    useSortable({
      id: article.id,
      data: {
        article,
        isCategory,
        type: isCategory ? 'category' : 'article',
        dropPosition: 'inside',
      },
    })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    position: 'relative',
    zIndex: isDragging ? 999 : 1,
  }

  const { setNodeRef: topSetNodeRef, isOver: topIsOver } = useDroppable({
    id: `${article.id}-before`,
    data: { article, isCategory, dropArea: 'before', articleId: article.id },
  })

  const isOver = over?.id === article.id && active?.id !== article.id
  const isBeingDraggedOver = isOver && !isDragging

  const itemHref = useMemo(() => {
    const path = slugPaths[article.id] ?? getFullSlugPath(article, articles)
    return `${basePath}/editor/~/${path}?tab=articles`
  }, [article, articles, slugPaths, basePath])

  const icon = isCategory ? (
    isOpen ? (
      <FolderOpen className='size-4 shrink-0 text-muted-foreground' />
    ) : (
      <FolderClosed className='size-4 shrink-0 text-muted-foreground' />
    )
  ) : (
    <FileText className='size-4 shrink-0 text-muted-foreground' />
  )

  const displayName = article.emoji ? `${article.emoji} ${article.title}` : article.title

  const handleRenameSubmit = async (values: {
    title: string
    emoji: string | null
    slug?: string
  }) => {
    await renameArticle(article.id, {
      title: values.title,
      emoji: values.emoji,
      slug: values.slug,
    })
  }

  const handleAddSubItem = async () => {
    const created = await createArticle({ parentId: article.id })
    if (created) {
      const path = `${basePath}/editor/~/${getFullSlugPath(created, [...articles, created])}?tab=articles`
      router.push(path)
    }
  }

  const handleAddAfter = async () => {
    const created = await createArticle({
      parentId: article.parentId,
      adjacentTo: article.id,
      position: 'after',
    })
    if (created) {
      const path = `${basePath}/editor/~/${getFullSlugPath(created, [...articles, created])}?tab=articles`
      router.push(path)
    }
  }

  return (
    <div className='relative'>
      <div ref={topSetNodeRef} className={cn('absolute left-0 right-0 h-6')}>
        <div className={cn('h-1 bg-transparent', { 'bg-blue-500': topIsOver })} />
      </div>
      <div ref={setNodeRef} style={style} className={cn('relative', isBeingDraggedOver && 'z-10')}>
        {isBeingDraggedOver && (
          <div className='absolute inset-[4px] z-10 rounded-md border border-dashed border-primary/30 bg-primary/10' />
        )}

        <div className='group/line absolute -bottom-px left-0 right-0 z-10 h-[12px]'>
          <button
            onClick={handleAddAfter}
            className='peer absolute bottom-[-8px] left-[-8px] z-1 inline-flex rounded-full p-1 text-muted-foreground opacity-0 hover:bg-blue-500 hover:text-white group-hover/line:opacity-100'
            type='button'
            aria-label='Add item after'>
            <svg
              xmlns='http://www.w3.org/2000/svg'
              fill='none'
              viewBox='0 0 16 16'
              preserveAspectRatio='xMidYMid meet'
              width='10'
              height='10'
              style={{ verticalAlign: 'middle' }}>
              <path
                fill='currentColor'
                d='M8.6 3a.6.6 0 0 0-1.2 0v4.4H3a.6.6 0 0 0 0 1.2h4.4V13a.6.6 0 1 0 1.2 0V8.6H13a.6.6 0 1 0 0-1.2H8.6V3Z'
              />
            </svg>
          </button>
          <div className='absolute bottom-0 left-0 right-0 h-[2px] peer-hover:bg-blue-500' />
        </div>

        <div
          className={cn(
            'group relative flex items-center rounded-md text-sm text-muted-foreground hover:bg-background focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
            {
              'bg-background text-accent-foreground': isActive,
              'cursor-grab': !isDragging,
              'cursor-grabbing': isDragging,
            }
          )}
          data-is-category={isCategory ? 'true' : 'false'}>
          <div
            className='flex cursor-grab items-center px-1 opacity-0 group-hover:opacity-100'
            {...attributes}
            {...listeners}>
            <GripVertical className='size-4 text-muted-foreground' />
          </div>

          <div
            onClick={(e) => {
              if (isDragging) e.preventDefault()
              if (!isActive) router.push(itemHref)
            }}
            className={cn(
              'flex flex-1 items-center rounded-md px-2 py-2 text-sm',
              'transition-colors duration-200',
              'focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
              isActive && 'font-medium text-accent-foreground',
              isDragging && 'pointer-events-none'
            )}>
            <span className='mr-2 flex items-center'>{icon}</span>
            <div className='flex flex-1 items-center'>
              <span>{displayName}</span>
              {isCategory && (
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onToggleOpen?.(article.id)
                  }}
                  className='ml-1 rounded-sm p-0.5 hover:bg-accent/50'
                  aria-label={isOpen ? 'Collapse' : 'Expand'}>
                  <ChevronRight
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                      isOpen && 'rotate-90'
                    )}
                  />
                </button>
              )}
            </div>
          </div>

          {!article.isPublished && (
            <div className='pointer-events-none ml-1'>
              <EyeOff size={16} />
            </div>
          )}

          <div className='ml-1 mr-2 opacity-0 transition-opacity group-hover:opacity-100'>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  className='hover: rounded-md p-1 hover:bg-primary/5 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring'
                  aria-label='More options'>
                  <MoreVertical className='size-4 text-muted-foreground' />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-56'>
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={handleAddSubItem}>
                    <Files /> Add Sub-item
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsRenameDialogOpen(true)}>
                    <TypeOutline /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => duplicateArticle(article)}>
                    <BookCopy /> Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href='#'>
                      <Pencil /> Edit Article
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => publishArticle(article.id, !article.isPublished)}>
                    <EyeOff />
                    {article.isPublished ? 'Unpublish' : 'Publish'}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => deleteArticle(article.id)} variant='destructive'>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <ArticleRenameDialog
              open={isRenameDialogOpen}
              onOpenChange={setIsRenameDialogOpen}
              article={article}
              onSubmit={handleRenameSubmit}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
