// apps/web/src/components/kb/ui/editor/container-article-placeholder.tsx
'use client'

import { ArticleKind } from '@auxx/database/enums'
import type { ArticleKind as ArticleKindType } from '@auxx/database/types'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon, getIcon } from '@auxx/ui/components/icons'
import { getFullSlugPath } from '@auxx/ui/components/kb/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Database, ExternalLink, FileText, FolderClosed, Heading, Link2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { forwardRef, useCallback, useMemo, useRef, useState } from 'react'
import { useArticleList } from '../../hooks/use-article-list'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleMeta } from '../../store/article-store'
import { usePendingInsertStore } from '../../store/pending-insert-store'
import { LinkArticlePicker } from '../sidebar/link-article-picker'
import { ArticleEditorHeader } from './article-editor-header'
import { ArticleEditorTop } from './article-editor-top'
import { useKBEditorAccess } from './kb-editor-access-context'

interface ContainerArticlePlaceholderProps {
  article: ArticleMeta
  knowledgeBaseId: string
}

interface QuickCreateOption {
  kind: ArticleKindType
  label: string
  Icon: React.ComponentType<{ className?: string }>
}

const TAB_OPTIONS: QuickCreateOption[] = [
  { kind: ArticleKind.page, label: 'Page', Icon: FileText },
  { kind: ArticleKind.category, label: 'Category', Icon: FolderClosed },
  { kind: ArticleKind.link, label: 'Link', Icon: Link2 },
  { kind: ArticleKind.header, label: 'Section header', Icon: Heading },
]

const HEADER_OPTIONS: QuickCreateOption[] = [
  { kind: ArticleKind.page, label: 'Page', Icon: FileText },
  { kind: ArticleKind.category, label: 'Category', Icon: FolderClosed },
  { kind: ArticleKind.link, label: 'Link', Icon: Link2 },
]

/**
 * Rendered in the right pane when the URL resolves to a structural
 * container (`tab`, `header`, or `link`). Reuses the article editor's
 * header + top blocks so the surface matches a real article — same
 * page-settings cluster, same icon/title/description chrome — then
 * swaps the body for a quick-create list of tree rows (tab/header) — create
 * actions, a "Link an article" popover, and the existing children — or an
 * Open-link CTA (link). `ArticleCoverStrip` self-gates for these
 * kinds, so the cover slot is hidden automatically.
 */
export function ContainerArticlePlaceholder({
  article,
  knowledgeBaseId,
}: ContainerArticlePlaceholderProps) {
  const { canEdit } = useKBEditorAccess()
  const router = useRouter()
  const articles = useArticleList(knowledgeBaseId)
  const { isCreating, updateArticleDraft } = useArticleMutations(knowledgeBaseId)
  const setPending = usePendingInsertStore((s) => s.setPending)
  const optionsRef = useRef<HTMLDivElement>(null)
  const linkButtonRef = useRef<HTMLAnchorElement>(null)
  const [linkOpen, setLinkOpen] = useState(false)

  const children = useMemo(
    () =>
      articles
        .filter((a) => a.parentId === article.id)
        .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0)),
    [articles, article.id]
  )

  const basePath = `/app/kb/${knowledgeBaseId}`
  const isLink = article.articleKind === ArticleKind.link
  const options =
    article.articleKind === ArticleKind.tab
      ? TAB_OPTIONS
      : article.articleKind === ArticleKind.header
        ? HEADER_OPTIONS
        : null

  const handleOpenChild = (child: ArticleMeta) => {
    if (child.articleKind === ArticleKind.link) {
      const url = child.slug && /^[a-z][a-z0-9+.-]*:/i.test(child.slug) ? child.slug : null
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
      return
    }
    const slug = getFullSlugPath(child, articles)
    router.push(`${basePath}/editor/~/${slug}?panel=articles`)
  }

  const childIcon = (child: ArticleMeta) => {
    if (child.emoji && getIcon(child.emoji)) {
      return <EntityIcon iconId={child.emoji} variant='bare' size='sm' />
    }
    if (child.articleKind === ArticleKind.category) {
      return <FolderClosed className='size-4 text-muted-foreground' />
    }
    if (child.articleKind === ArticleKind.header) {
      return <Heading className='size-4 text-muted-foreground' />
    }
    if (child.articleKind === ArticleKind.link) {
      return <Link2 className='size-4 text-muted-foreground' />
    }
    return <FileText className='size-4 text-muted-foreground' />
  }

  const handleMetadataUpdate = useCallback(
    async (changes: { title?: string; description?: string }) => {
      await updateArticleDraft(article.id, changes)
    },
    [article.id, updateArticleDraft]
  )

  const focusContent = useCallback(() => {
    if (isLink) {
      linkButtonRef.current?.focus()
      return
    }
    optionsRef.current?.querySelector<HTMLElement>('button')?.focus()
  }, [isLink])

  const handleCreate = (kind: ArticleKindType) => {
    setPending({ articleKind: kind, parentId: article.id })
  }

  const linkUrl =
    isLink && article.slug && /^[a-z][a-z0-9+.-]*:/i.test(article.slug) ? article.slug : null

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <ArticleEditorHeader article={article} knowledgeBaseId={knowledgeBaseId} />
      <ScrollArea className='flex-1'>
        <div className='flex min-h-min flex-1 flex-col'>
          <div className='relative mx-auto flex h-full w-full max-w-3xl flex-1 flex-col px-7'>
            <div className='flex min-h-0 flex-1 flex-col pb-10'>
              <div aria-hidden className='h-11 pt-4' />
              <ArticleEditorTop
                article={article}
                knowledgeBaseId={knowledgeBaseId}
                onUpdateMetadata={handleMetadataUpdate}
                onAdvanceToContent={focusContent}
                readOnly={!canEdit}
              />
              {isLink ? (
                <div className='mx-auto mt-4 w-full max-w-md'>
                  {linkUrl ? (
                    <Button asChild variant='outline' className='w-full'>
                      <a
                        ref={linkButtonRef}
                        href={linkUrl}
                        target='_blank'
                        rel='noopener noreferrer'>
                        <ExternalLink /> Open link
                      </a>
                    </Button>
                  ) : (
                    <p className='text-center text-muted-foreground text-sm'>
                      This link doesn't have a URL yet. Set one from page settings.
                    </p>
                  )}
                </div>
              ) : options ? (
                <div
                  ref={optionsRef}
                  className='mt-4 w-full overflow-hidden rounded-xl border text-left'>
                  {canEdit && (
                    <>
                      <GroupLabel>
                        {article.articleKind === ArticleKind.tab
                          ? 'Add to this tab'
                          : 'Add to this section header'}
                      </GroupLabel>
                      <div className='flex flex-col p-1'>
                        {options.map(({ kind, label, Icon }) => (
                          <RowButton
                            key={kind}
                            disabled={isCreating}
                            onClick={() => handleCreate(kind)}>
                            <TreeRow
                              icon={<Icon className='size-4 text-muted-foreground' />}
                              title={label}
                            />
                          </RowButton>
                        ))}
                        <Popover open={linkOpen} onOpenChange={setLinkOpen}>
                          <PopoverTrigger asChild>
                            <RowButton>
                              <TreeRow
                                icon={<Database className='size-4 text-muted-foreground' />}
                                title='Link an article'
                              />
                            </RowButton>
                          </PopoverTrigger>
                          <PopoverContent align='start' className='w-72 p-0'>
                            <LinkArticlePicker
                              knowledgeBaseId={knowledgeBaseId}
                              targetParentArticleId={article.id}
                              onClose={() => setLinkOpen(false)}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                    </>
                  )}
                  {children.length > 0 && (
                    <>
                      <div className='border-t' />
                      <GroupLabel>Inside</GroupLabel>
                      <div className='flex flex-col p-1'>
                        {children.map((child) => (
                          <RowButton key={child.id} onClick={() => handleOpenChild(child)}>
                            <TreeRow icon={childIcon(child)} title={child.title || 'Untitled'} />
                          </RowButton>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

/** Small uppercase-ish group heading, mirrors the old CommandGroup label. */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className='px-2 py-1.5 text-xs font-medium text-muted-foreground'>{children}</div>
}

/**
 * Full-width clickable row wrapping a {@link TreeRow}. forwardRef so it can be a
 * `PopoverTrigger asChild` (Radix needs the ref + click props on the trigger).
 */
const RowButton = forwardRef<HTMLButtonElement, React.ComponentProps<'button'>>(function RowButton(
  { className, children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type='button'
      className={cn('block w-full rounded-md text-left disabled:opacity-50', className)}
      {...props}>
      {children}
    </button>
  )
})
