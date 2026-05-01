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
import { EntityIcon, getIcon } from '@auxx/ui/components/icons'
import {
  getArticleSlugPaths,
  getFullSlugPath,
  getKbPreviewHref,
  isArticleActive,
} from '@auxx/ui/components/kb/utils'
import { cn } from '@auxx/ui/lib/utils'
import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Archive,
  ArchiveRestore,
  BookCopy,
  ChevronRight,
  Cog,
  Copy,
  Download,
  Eye,
  EyeOff,
  Files,
  FileText,
  FolderClosed,
  FolderOpen,
  GripVertical,
  MoreVertical,
  Send,
  Trash2,
} from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import { useArticleList } from '../../hooks/use-article-list'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import { usePublishWithConfirm } from '../../hooks/use-publish-with-confirm'
import type { ArticleMeta, ArticleTreeNode } from '../../store/article-store'
import { ArticleSettingsDialog } from '../editor/article-settings-dialog'
import { ArticleInsertLine } from './article-insert-line'

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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const isCategory =
    article.articleKind === 'category' || (article.children && article.children.length > 0)
  const isArchived = article.status === 'ARCHIVED'

  const articles = useArticleList(knowledgeBaseId)
  const { createArticle, deleteArticle, archiveArticle, unarchiveArticle, duplicateArticle } =
    useArticleMutations(knowledgeBaseId)
  const { requestPublish, requestUnpublish, ConfirmDialog } = usePublishWithConfirm(knowledgeBaseId)

  const utils = api.useUtils()
  const fetchExport = async () =>
    utils.kb.exportArticleMarkdown.fetch({ id: article.id, knowledgeBaseId })

  const handleCopyMarkdown = async () => {
    try {
      const { markdown } = await fetchExport()
      await navigator.clipboard.writeText(markdown)
    } catch (error) {
      console.error('Failed to copy markdown', error)
    }
  }

  const handleDownloadMarkdown = async () => {
    try {
      const { markdown, filename } = await fetchExport()
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to download markdown', error)
    }
  }

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
    return `${basePath}/editor/~/${path}?panel=articles`
  }, [article, articles, slugPaths, basePath])

  const previewHref = useMemo(() => {
    const path = slugPaths[article.id] ?? getFullSlugPath(article, articles)
    return getKbPreviewHref(knowledgeBaseId, path)
  }, [article, articles, slugPaths, knowledgeBaseId])

  const hasCustomIcon = !!article.emoji && !!getIcon(article.emoji)
  const icon = isCategory ? (
    isOpen ? (
      <FolderOpen className='size-4 shrink-0 text-muted-foreground' />
    ) : (
      <FolderClosed className='size-4 shrink-0 text-muted-foreground' />
    )
  ) : hasCustomIcon ? (
    <EntityIcon
      iconId={article.emoji as string}
      variant='bare'
      size='sm'
      className='text-muted-foreground'
    />
  ) : (
    <FileText className='size-4 shrink-0 text-muted-foreground' />
  )

  const displayName = article.title

  const statusIcon = isArchived ? (
    <Archive size={16} />
  ) : !article.isPublished ? (
    <EyeOff size={16} />
  ) : null
  const statusLabel = isArchived ? 'Archived' : !article.isPublished ? 'Unpublished' : undefined

  const handleAddSubItem = async () => {
    const created = await createArticle({ parentId: article.id })
    if (created) {
      const path = `${basePath}/editor/~/${getFullSlugPath(created, [...articles, created])}?panel=articles`
      router.push(path)
    }
  }

  return (
    <div className='relative'>
      <div ref={topSetNodeRef} className={cn('absolute left-0 right-0 h-6')}>
        <div className={cn('h-1 bg-transparent', { 'bg-blue-500': topIsOver })} />
      </div>
      <div
        ref={setNodeRef}
        style={style}
        className={cn('relative', isBeingDraggedOver && isCategory && 'z-10')}>
        {isBeingDraggedOver && isCategory && (
          <div className='absolute inset-[4px] z-10 rounded-md border border-dashed border-primary/30 bg-primary/10' />
        )}

        <ArticleInsertLine
          article={article}
          knowledgeBaseId={knowledgeBaseId}
          mode={isCategory && isOpen ? 'first-child' : 'sibling-after'}
        />

        <div
          className={cn(
            'group relative flex items-center rounded-md text-sm text-muted-foreground hover:bg-background focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
            {
              'bg-background text-accent-foreground': isActive,
              'cursor-grab': !isDragging,
              'cursor-grabbing': isDragging,
              'opacity-60': isArchived,
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
              <span className='truncate'>{displayName}</span>
              {article.hasUnpublishedChanges && article.isPublished && (
                <span
                  className='ml-1.5 inline-block size-1.5 shrink-0 rounded-full bg-amber-500'
                  title='Unsaved changes'
                />
              )}
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

          <div className='mr-2'>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  className={cn(
                    'grid rounded-md p-1 text-muted-foreground hover:bg-primary/5 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
                    !statusIcon && 'opacity-0 transition-opacity group-hover:opacity-100'
                  )}
                  aria-label='More options'
                  title={statusLabel}>
                  {statusIcon ? (
                    <span className='col-start-1 row-start-1 group-hover:invisible'>
                      {statusIcon}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      'col-start-1 row-start-1',
                      statusIcon && 'invisible group-hover:visible'
                    )}>
                    <MoreVertical className='size-4' />
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-56'>
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={handleAddSubItem}>
                    <Files /> Add sub-item
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsSettingsOpen(true)}>
                    <Cog /> Page settings
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={previewHref} target='_blank' rel='noopener'>
                      <Eye /> Preview
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => duplicateArticle(article)}>
                    <BookCopy /> Duplicate
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={handleCopyMarkdown}>
                    <Copy /> Copy as markdown
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDownloadMarkdown}>
                    <Download /> Download .md
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  {isArchived ? (
                    <DropdownMenuItem onClick={() => unarchiveArticle(article.id)}>
                      <ArchiveRestore /> Unarchive
                    </DropdownMenuItem>
                  ) : article.isPublished ? (
                    <>
                      <DropdownMenuItem onClick={() => requestUnpublish(article)}>
                        <EyeOff /> Unpublish
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => archiveArticle(article.id)}>
                        <Archive /> Archive
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      <DropdownMenuItem onClick={() => requestPublish(article)}>
                        <Send /> Publish
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => archiveArticle(article.id)}>
                        <Archive /> Archive
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => deleteArticle(article.id)} variant='destructive'>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ArticleSettingsDialog
              open={isSettingsOpen}
              onOpenChange={setIsSettingsOpen}
              article={article}
              knowledgeBaseId={knowledgeBaseId}
            />
            <ConfirmDialog />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Stripped-down visual of {@link ArticleSidebarItem} (and its sibling
 * {@link import('./article-header-item').ArticleHeaderItem}) for use inside a
 * dnd-kit `<DragOverlay>`. Branches on `articleKind` so the preview matches
 * what the user picked up: header / category / page.
 */
export function ArticleSidebarItemPreview({ article }: { article: ArticleMeta }) {
  if (article.articleKind === 'header') {
    return (
      <div
        className='pointer-events-none flex items-center rounded-md border bg-background px-2 py-1 shadow-md'
        style={{ maxWidth: '280px' }}>
        <span className='truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
          {article.title || 'Untitled'}
        </span>
      </div>
    )
  }

  const isCategory = article.articleKind === 'category'
  const isArchived = article.status === 'ARCHIVED'
  const hasCustomIcon = !!article.emoji && !!getIcon(article.emoji)

  const icon = isCategory ? (
    <FolderClosed className='size-4 shrink-0 text-muted-foreground' />
  ) : hasCustomIcon ? (
    <EntityIcon
      iconId={article.emoji as string}
      variant='bare'
      size='sm'
      className='text-muted-foreground'
    />
  ) : (
    <FileText className='size-4 shrink-0 text-muted-foreground' />
  )

  return (
    <div
      className={cn(
        'pointer-events-none flex items-center rounded-md border bg-background px-2 py-2 text-sm text-muted-foreground shadow-md',
        isArchived && 'opacity-60'
      )}
      style={{ maxWidth: '280px' }}>
      <span className='mr-2 flex items-center'>{icon}</span>
      <span className={cn('truncate', isCategory && 'font-medium text-foreground')}>
        {article.title || 'Untitled'}
      </span>
      {article.hasUnpublishedChanges && article.isPublished && (
        <span
          className='ml-1.5 inline-block size-1.5 shrink-0 rounded-full bg-amber-500'
          title='Unsaved changes'
        />
      )}
      {isArchived ? (
        <Archive size={16} className='ml-1 shrink-0' />
      ) : !article.isPublished ? (
        <EyeOff size={16} className='ml-1 shrink-0' />
      ) : null}
    </div>
  )
}
