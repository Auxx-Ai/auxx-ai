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
import { useMemo } from 'react'
import { useArticleList } from '../../hooks/use-article-list'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleMeta } from '../../store/article-store'
import { usePendingInsertStore } from '../../store/pending-insert-store'

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
 * container (`tab`, `header`, or `link`) — these kinds have no body of
 * their own, so we show an empty-state with quick-create actions for
 * the children the container can legally hold instead of mounting the
 * Tiptap article editor. Categories keep their normal editor since
 * they carry both a body and children.
 */
export function ContainerArticlePlaceholder({
  article,
  knowledgeBaseId,
}: ContainerArticlePlaceholderProps) {
  const router = useRouter()
  const articles = useArticleList(knowledgeBaseId)
  const { isCreating } = useArticleMutations(knowledgeBaseId)
  const setPending = usePendingInsertStore((s) => s.setPending)

  const children = useMemo(
    () =>
      articles
        .filter((a) => a.parentId === article.id)
        .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0)),
    [articles, article.id]
  )
  const childCount = children.length

  const basePath = `/app/kb/${knowledgeBaseId}`

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

  const kindLabel =
    article.articleKind === ArticleKind.tab
      ? 'Tab'
      : article.articleKind === ArticleKind.header
        ? 'Section header'
        : 'Link'

  const subtitle =
    article.articleKind === ArticleKind.link
      ? 'External link'
      : `${kindLabel} · ${childCount} ${childCount === 1 ? 'item' : 'items'} inside`

  const hasCustomIcon = !!article.emoji && !!getIcon(article.emoji)
  const fallbackIcon =
    article.articleKind === ArticleKind.link ? (
      <Link2 className='size-7 text-muted-foreground' />
    ) : article.articleKind === ArticleKind.header ? (
      <Heading className='size-7 text-muted-foreground' />
    ) : (
      <FolderClosed className='size-7 text-muted-foreground' />
    )

  const linkUrl =
    article.articleKind === ArticleKind.link &&
    article.slug &&
    /^[a-z][a-z0-9+.-]*:/i.test(article.slug)
      ? article.slug
      : null

  const handleCreate = (kind: ArticleKindType) => {
    // No `adjacentTo` / `position` → ArticleTreeSection treats this as an
    // append, putting the new child at the bottom of the container.
    setPending({ articleKind: kind, parentId: article.id })
  }

  const options =
    article.articleKind === ArticleKind.tab
      ? TAB_OPTIONS
      : article.articleKind === ArticleKind.header
        ? HEADER_OPTIONS
        : null

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <ScrollArea className='flex-1'>
        <div className='mx-auto flex w-full max-w-md flex-col items-center px-7 py-16 text-center'>
          <div className='mb-4'>
            {hasCustomIcon ? (
              <EntityIcon iconId={article.emoji as string} variant='bare' size='lg' />
            ) : (
              fallbackIcon
            )}
          </div>
          <h1 className='text-2xl font-semibold'>{article.title || 'Untitled'}</h1>
          <p className='mt-1 text-sm text-muted-foreground'>{subtitle}</p>

          {article.articleKind === ArticleKind.link ? (
            <div className='mt-8 w-full'>
              {linkUrl ? (
                <Button asChild variant='outline' className='w-full'>
                  <a href={linkUrl} target='_blank' rel='noopener noreferrer'>
                    <ExternalLink /> Open link
                  </a>
                </Button>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  This link doesn't have a URL yet. Set one from the sidebar.
                </p>
              )}
            </div>
          ) : options ? (
            <div className='mt-8 w-full text-left'>
              <Command className='rounded-md border bg-background'>
                <CommandList>
                  <CommandGroup>
                    <CommandGroupLabel>Add to this {kindLabel.toLowerCase()}</CommandGroupLabel>
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
      </ScrollArea>
    </div>
  )
}
