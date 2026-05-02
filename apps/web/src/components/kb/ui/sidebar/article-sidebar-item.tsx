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
  ExternalLink,
  Eye,
  EyeOff,
  Files,
  FileText,
  FolderClosed,
  FolderOpen,
  GripVertical,
  Link2,
  MoreVertical,
  Pencil,
  Send,
  Trash2,
} from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useArticleList } from '../../hooks/use-article-list'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import { usePublishWithConfirm } from '../../hooks/use-publish-with-confirm'
import type { ArticleMeta, ArticleTreeNode } from '../../store/article-store'
import { usePendingInsertStore } from '../../store/pending-insert-store'
import { ArticleSettingsDialog } from '../editor/article-settings-dialog'
import { ArticleInsertLine } from './article-insert-line'
import { RenameInput } from './rename-input'

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
  const isHeader = article.articleKind === 'header'
  const isLink = article.articleKind === 'link'
  const isCategory =
    !isHeader &&
    !isLink &&
    (article.articleKind === 'category' || (article.children && article.children.length > 0))
  const isArchived = article.status === 'ARCHIVED'
  // For link kind, slug stores the URL. Only treat it as openable if it
  // carries a real protocol — the empty-URL placeholder slug `link-<id>`
  // doesn't and shouldn't open anything.
  const linkUrl =
    isLink && article.slug && /^[a-z][a-z0-9+.-]*:/i.test(article.slug) ? article.slug : null

  const articles = useArticleList(knowledgeBaseId)
  const { deleteArticle, archiveArticle, unarchiveArticle, duplicateArticle, renameArticle } =
    useArticleMutations(knowledgeBaseId)
  const setPending = usePendingInsertStore((s) => s.setPending)
  const {
    requestPublish,
    requestUnpublish,
    ConfirmDialog: PublishConfirmDialog,
  } = usePublishWithConfirm(knowledgeBaseId)
  const [confirm, ConfirmDialog] = useConfirm()
  const [isRenaming, setIsRenaming] = useState(false)
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (navTimerRef.current) clearTimeout(navTimerRef.current)
    },
    []
  )

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
  const isActive = !isHeader && isArticleActive(article, pathname, basePath, slugPaths)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging, over, active } =
    useSortable({
      id: article.id,
      data: isHeader
        ? {
            article,
            isCategory: false,
            isHeaderContainer: true,
            type: 'header',
            dropPosition: 'inside',
          }
        : {
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
    zIndex: isDragging ? 999 : undefined,
  }

  const { setNodeRef: topSetNodeRef, isOver: topIsOver } = useDroppable({
    id: `${article.id}-before`,
    data: { article, isCategory, dropArea: 'before', articleId: article.id },
  })

  const isOver = over?.id === article.id && active?.id !== article.id
  const isBeingDraggedOver = isOver && !isDragging
  // Headers render a wrapping highlight at the group level (see
  // `article-tree-section`) so the affordance covers the whole section, not
  // just the header label row.
  const showInsideAffordance = isBeingDraggedOver && isCategory

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
  ) : isLink ? (
    <Link2 className='size-4 shrink-0 text-muted-foreground' />
  ) : (
    <FileText className='size-4 shrink-0 text-muted-foreground' />
  )

  const displayName = article.title

  const statusIcon = isArchived ? (
    <Archive className='size-4' />
  ) : !article.isPublished ? (
    <EyeOff className='size-4' />
  ) : null
  const statusLabel = isArchived ? 'Archived' : !article.isPublished ? 'Unpublished' : undefined

  const handleAddSubItem = () => {
    setPending({ articleKind: 'page', parentId: article.id })
  }

  const handleDelete = async () => {
    const hasChildren = article.children && article.children.length > 0
    const kindLabel = isHeader ? 'section header' : isCategory ? 'category' : 'page'
    const ok = await confirm({
      title: hasChildren ? `Delete '${article.title || 'Untitled'}'?` : `Delete ${kindLabel}?`,
      description: hasChildren
        ? isHeader
          ? 'Articles in this section will be moved up one level.'
          : `Children of this ${kindLabel} will be moved up one level.`
        : 'This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    await deleteArticle(article.id)
  }

  // Shared dropdown menu — same items for headers and pages, with the three
  // renderer-bound items (Preview / Copy as MD / Download .md) gated to
  // non-headers since headers have no body. Link kind drops Add-sub-item,
  // Preview, and the markdown items, and surfaces "Open link" at the top.
  const dropdownMenuContent = (
    <DropdownMenuContent align='end' className='w-56' onCloseAutoFocus={(e) => e.preventDefault()}>
      {isLink && linkUrl && (
        <>
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <a href={linkUrl} target='_blank' rel='noopener noreferrer'>
                <ExternalLink /> Open link
              </a>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={() => setIsRenaming(true)}>
          <Pencil /> Rename
        </DropdownMenuItem>
        {!isLink && (
          <DropdownMenuItem onClick={handleAddSubItem}>
            <Files /> Add sub-item
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => setIsSettingsOpen(true)}>
          <Cog /> Page settings
        </DropdownMenuItem>
        {!isHeader && !isLink && (
          <DropdownMenuItem asChild>
            <a href={previewHref} target='_blank' rel='noopener'>
              <Eye /> Preview
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => duplicateArticle(article)}>
          <BookCopy /> Duplicate
        </DropdownMenuItem>
      </DropdownMenuGroup>
      {!isHeader && !isLink && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={handleCopyMarkdown}>
              <Copy /> Copy as markdown
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDownloadMarkdown}>
              <Download /> Download .md
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </>
      )}
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
      <DropdownMenuItem onClick={handleDelete} variant='destructive'>
        <Trash2 /> Delete
      </DropdownMenuItem>
    </DropdownMenuContent>
  )

  // Shared dialog/confirm portals — rendered once regardless of branch.
  const dialogs = (
    <>
      <ArticleSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        article={article}
        knowledgeBaseId={knowledgeBaseId}
      />
      <ConfirmDialog />
      <PublishConfirmDialog />
    </>
  )

  return (
    <div className='relative'>
      <div
        ref={topSetNodeRef}
        className={cn('absolute left-0 right-0', isHeader ? '-top-1 h-4' : 'h-6')}>
        <div className={cn('h-[1px] bg-transparent', { 'bg-blue-500': topIsOver })} />
      </div>
      <div
        ref={setNodeRef}
        style={style}
        className={cn('relative', showInsideAffordance && !isHeader && 'z-10')}>
        {showInsideAffordance && (
          <div
            className={cn(
              'pointer-events-none absolute z-10 rounded-md border border-dashed bg-primary/10',
              isHeader ? 'inset-x-0 inset-y-1 border-primary/40' : 'inset-[4px] border-primary/30'
            )}
          />
        )}

        <ArticleInsertLine
          article={article}
          knowledgeBaseId={knowledgeBaseId}
          mode={isHeader || (isCategory && isOpen) ? 'first-child' : 'sibling-after'}
        />

        <div
          className={cn(
            'group/row relative flex items-center',
            isHeader
              ? cn(
                  'pb-1 pt-3',
                  isDragging ? 'cursor-grabbing' : 'cursor-grab',
                  isArchived && 'opacity-60'
                )
              : cn(
                  'cursor-default rounded-md text-sm text-muted-foreground hover:bg-background',
                  'focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
                  isActive && 'bg-background text-accent-foreground',
                  isArchived && 'opacity-60'
                )
          )}
          data-is-category={isCategory ? 'true' : 'false'}>
          <div
            className={cn(
              'flex cursor-grab items-center px-1',
              isDragging && 'cursor-grabbing',
              isHeader && '-ml-3.5 opacity-0 group-hover/row:opacity-100'
            )}
            {...attributes}
            {...(isRenaming ? {} : listeners)}>
            {!isHeader && (
              <span className='flex items-center group-hover/row:hidden size-4'>{icon}</span>
            )}
            <span className={cn('items-center', isHeader ? 'flex' : 'hidden group-hover/row:flex')}>
              <GripVertical
                className={cn('text-muted-foreground', isHeader ? 'size-3.5' : 'size-4')}
              />
            </span>
          </div>

          <div
            onClick={(e) => {
              if (isLink && (e.metaKey || e.ctrlKey)) {
                if (linkUrl) window.open(linkUrl, '_blank', 'noopener,noreferrer')
                return
              }
              if (isHeader || isLink) return
              if (isRenaming) return
              if (isDragging) {
                e.preventDefault()
                return
              }
              if (e.detail >= 2) {
                if (navTimerRef.current) {
                  clearTimeout(navTimerRef.current)
                  navTimerRef.current = null
                }
                return
              }
              if (navTimerRef.current) clearTimeout(navTimerRef.current)
              navTimerRef.current = setTimeout(() => {
                navTimerRef.current = null
                if (!isActive) router.push(itemHref)
              }, 200)
            }}
            onDoubleClick={() => {
              if (navTimerRef.current) {
                clearTimeout(navTimerRef.current)
                navTimerRef.current = null
              }
              setIsRenaming(true)
            }}
            className={cn(
              'flex flex-1 items-center transition-colors duration-200',
              'focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
              !isHeader && 'rounded-md px-2 py-2 text-sm',
              !isHeader && isActive && 'font-medium text-accent-foreground',
              isHeader && 'cursor-text',
              isDragging && 'pointer-events-none'
            )}>
            <div className='flex flex-1 items-center'>
              {isRenaming ? (
                <RenameInput
                  initialValue={article.title}
                  onCommit={(trimmed) => {
                    void renameArticle(article.id, { title: trimmed })
                    setIsRenaming(false)
                  }}
                  onCancel={() => setIsRenaming(false)}
                  inputClassName={cn(
                    'rounded-sm bg-background px-1 outline-none ring-1 ring-primary',
                    isHeader ? 'text-xs font-semibold uppercase tracking-wide' : 'text-sm'
                  )}
                  minWidth={80}
                />
              ) : (
                <span
                  className={cn(
                    'truncate',
                    isHeader &&
                      'text-xs font-semibold uppercase tracking-wide text-muted-foreground'
                  )}>
                  {displayName || (isHeader ? 'Untitled' : '')}
                </span>
              )}
              {article.hasUnpublishedChanges && article.isPublished && (
                <span
                  className='ml-1.5 inline-block size-1.5 shrink-0 rounded-full bg-amber-500'
                  title='Unsaved changes'
                />
              )}
              {!isHeader && isCategory && (
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
              {isLink && (
                <ExternalLink
                  className='ml-1 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-60'
                  aria-hidden
                />
              )}
            </div>
          </div>

          <div className='mr-2'>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  className={cn(
                    'grid rounded-md p-1 text-muted-foreground hover:bg-primary/5',
                    'focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
                    !statusIcon && 'opacity-0 transition-opacity group-hover/row:opacity-100'
                  )}
                  aria-label='More options'
                  title={statusLabel}>
                  {statusIcon ? (
                    <span className='col-start-1 row-start-1 group-hover/row:invisible'>
                      {statusIcon}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      'col-start-1 row-start-1',
                      statusIcon && 'invisible group-hover/row:visible'
                    )}>
                    <MoreVertical className='size-4' />
                  </span>
                </button>
              </DropdownMenuTrigger>
              {dropdownMenuContent}
            </DropdownMenu>
          </div>
        </div>
      </div>
      {dialogs}
    </div>
  )
}

/**
 * Stripped-down visual of {@link ArticleSidebarItem} for use inside a
 * dnd-kit `<DragOverlay>`. Branches on `articleKind` so the preview matches
 * what the user picked up: header / category / page.
 */
export function ArticleSidebarItemPreview({
  article,
  descendants,
}: {
  article: ArticleMeta
  descendants?: ArticleMeta[]
}) {
  if (article.articleKind === 'header') {
    return (
      <div
        className='pointer-events-none flex flex-col gap-0.5 rounded-md border bg-background p-1 shadow-md'
        style={{ maxWidth: '280px' }}>
        <span className='truncate px-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
          {article.title || 'Untitled'}
        </span>
        {descendants && descendants.length > 0 && (
          <div className='flex flex-col gap-0.5 pl-2'>
            {descendants.map((d) => {
              const dHasIcon = !!d.emoji && !!getIcon(d.emoji)
              const dIcon =
                d.articleKind === 'category' ? (
                  <FolderClosed className='size-3.5 shrink-0 text-muted-foreground' />
                ) : dHasIcon ? (
                  <EntityIcon
                    iconId={d.emoji as string}
                    variant='bare'
                    size='sm'
                    className='text-muted-foreground'
                  />
                ) : (
                  <FileText className='size-3.5 shrink-0 text-muted-foreground' />
                )
              return (
                <div
                  key={d.id}
                  className='flex items-center gap-1.5 rounded px-1 py-0.5 text-xs text-muted-foreground'>
                  {dIcon}
                  <span
                    className={cn(
                      'truncate',
                      d.articleKind === 'category' && 'font-medium text-foreground'
                    )}>
                    {d.title || 'Untitled'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const isCategory = article.articleKind === 'category'
  const isLinkPreview = article.articleKind === 'link'
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
  ) : isLinkPreview ? (
    <Link2 className='size-4 shrink-0 text-muted-foreground' />
  ) : (
    <FileText className='size-4 shrink-0 text-muted-foreground' />
  )

  return (
    <div
      className={cn(
        'pointer-events-none opacity-60 flex items-center rounded-md border bg-background px-2 py-2 text-sm text-muted-foreground shadow-md'
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
        <Archive size={16} className='ml-auto shrink-0' />
      ) : !article.isPublished ? (
        <EyeOff size={16} className='ml-auto shrink-0' />
      ) : null}
    </div>
  )
}
