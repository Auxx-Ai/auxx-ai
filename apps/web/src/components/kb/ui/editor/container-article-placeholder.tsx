// apps/web/src/components/kb/ui/editor/container-article-placeholder.tsx
'use client'

import { ArticleKind } from '@auxx/database/enums'
import type { ArticleKind as ArticleKindType } from '@auxx/database/types'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { EntityIcon, getIcon } from '@auxx/ui/components/icons'
import { getFullSlugPath } from '@auxx/ui/components/kb/utils'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { ExternalLink, FileText, FolderClosed, Heading, Link2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useRef } from 'react'
import { useArticleList } from '../../hooks/use-article-list'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleMeta } from '../../store/article-store'
import { usePendingInsertStore } from '../../store/pending-insert-store'
import { ArticleEditorHeader } from './article-editor-header'
import { ArticleEditorTop } from './article-editor-top'

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
 * swaps the body for a quick-create Command list (tab/header) or an
 * Open-link CTA (link). `ArticleCoverStrip` self-gates for these
 * kinds, so the cover slot is hidden automatically.
 */
export function ContainerArticlePlaceholder({
  article,
  knowledgeBaseId,
}: ContainerArticlePlaceholderProps) {
  const router = useRouter()
  const articles = useArticleList(knowledgeBaseId)
  const { isCreating, updateArticleDraft } = useArticleMutations(knowledgeBaseId)
  const setPending = usePendingInsertStore((s) => s.setPending)
  const commandWrapperRef = useRef<HTMLDivElement>(null)
  const linkButtonRef = useRef<HTMLAnchorElement>(null)

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
    const first = commandWrapperRef.current?.querySelector<HTMLElement>('[cmdk-item]')
    first?.focus()
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
                <div ref={commandWrapperRef} className='mt-4 w-full text-left'>
                  <Command className='overflow-hidden rounded-xl border'>
                    <CommandList>
                      <CommandGroup>
                        <CommandGroupLabel>
                          {article.articleKind === ArticleKind.tab
                            ? 'Add to this tab'
                            : 'Add to this section header'}
                        </CommandGroupLabel>
                        {options.map(({ kind, label, Icon }) => (
                          <CommandItem
                            key={kind}
                            value={`create-${kind}`}
                            disabled={isCreating}
                            onSelect={() => handleCreate(kind)}>
                            <Icon className='size-4 text-muted-foreground' />
                            <span>{label}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                      {children.length > 0 && (
                        <>
                          <CommandSeparator />
                          <CommandGroup>
                            <CommandGroupLabel>Inside</CommandGroupLabel>
                            {children.map((child) => (
                              <CommandItem
                                key={child.id}
                                value={`open-${child.id}`}
                                onSelect={() => handleOpenChild(child)}>
                                {childIcon(child)}
                                <span className='truncate'>{child.title || 'Untitled'}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </>
                      )}
                    </CommandList>
                  </Command>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
