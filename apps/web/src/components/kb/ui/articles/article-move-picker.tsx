// apps/web/src/components/kb/ui/articles/article-move-picker.tsx
'use client'

import {
  Command,
  CommandBreadcrumb,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandNavigation,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { ChevronRight, CornerDownRight } from 'lucide-react'
import { type KeyboardEvent, useCallback, useMemo, useState } from 'react'
import { useArticleList } from '../../hooks/use-article-list'

interface MoveNavItem {
  id: string
  label: string
  type: 'tab'
}

interface ArticleMovePickerProps {
  knowledgeBaseId: string
  /** Article being moved — excluded from valid destinations along with its descendants. */
  articleId: string
  /** Highlight the article's current parent. */
  currentParentId: string | null
  /** Called with the chosen parentId (a tab id, or a category id under a tab). */
  onPick: (parentId: string) => void
  onClose: () => void
}

export function ArticleMovePicker(props: ArticleMovePickerProps) {
  return (
    <CommandNavigation<MoveNavItem>>
      <ArticleMovePickerContent {...props} />
    </CommandNavigation>
  )
}

function ArticleMovePickerContent({
  knowledgeBaseId,
  articleId,
  currentParentId,
  onPick,
  onClose,
}: ArticleMovePickerProps) {
  const articles = useArticleList(knowledgeBaseId)
  const [search, setSearch] = useState('')
  const { push, pop, isAtRoot, current } = useCommandNavigation<MoveNavItem>()

  // Self + descendants are never valid destinations.
  const forbiddenIds = useMemo(() => {
    const banned = new Set<string>([articleId])
    let added = true
    while (added) {
      added = false
      for (const a of articles) {
        if (a.parentId && banned.has(a.parentId) && !banned.has(a.id)) {
          banned.add(a.id)
          added = true
        }
      }
    }
    return banned
  }, [articles, articleId])

  const tabs = useMemo(
    () =>
      articles
        .filter((a) => a.articleKind === 'tab' && !forbiddenIds.has(a.id))
        .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0)),
    [articles, forbiddenIds]
  )

  const insideTab = current?.type === 'tab' ? current : null

  const subItems = useMemo(() => {
    if (!insideTab) return []
    return articles
      .filter(
        (a) =>
          a.parentId === insideTab.id && a.articleKind === 'category' && !forbiddenIds.has(a.id)
      )
      .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0))
  }, [articles, forbiddenIds, insideTab])

  const q = search.toLowerCase()

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if ((e.key === 'Backspace' || e.key === 'ArrowLeft') && !search) {
        if (!isAtRoot) {
          e.preventDefault()
          pop()
          return
        }
        if (e.key === 'Backspace') {
          e.preventDefault()
          onClose()
        }
      }
    },
    [isAtRoot, onClose, pop, search]
  )

  return (
    <Command className='w-72 overflow-hidden' shouldFilter={false} onKeyDown={handleKeyDown}>
      <CommandBreadcrumb rootLabel='Move to' />
      <CommandInput
        placeholder={insideTab ? `Search inside ${insideTab.label}…` : 'Search tabs…'}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        {isAtRoot && (
          <CommandGroup heading='Tabs'>
            {tabs
              .filter((t) => !q || t.title.toLowerCase().includes(q))
              .map((t) => (
                <CommandItem
                  key={t.id}
                  value={t.title}
                  onSelect={() => {
                    push({ id: t.id, label: t.title || 'Untitled', type: 'tab' })
                    setSearch('')
                  }}
                  className='flex items-center justify-between'>
                  <span>{t.title || 'Untitled'}</span>
                  <ChevronRight className='size-4 opacity-50' />
                </CommandItem>
              ))}
          </CommandGroup>
        )}

        {insideTab && (
          <CommandGroup heading={insideTab.label}>
            <CommandItem
              value={`top-${insideTab.id}`}
              onSelect={() => onPick(insideTab.id)}
              data-current={currentParentId === insideTab.id || undefined}>
              <CornerDownRight className='mr-2 size-4 opacity-50' />
              <span>Top of {insideTab.label}</span>
            </CommandItem>
            {subItems
              .filter((c) => !q || c.title.toLowerCase().includes(q))
              .map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.title}
                  onSelect={() => onPick(c.id)}
                  data-current={currentParentId === c.id || undefined}>
                  <span>{c.title || 'Untitled'}</span>
                </CommandItem>
              ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
