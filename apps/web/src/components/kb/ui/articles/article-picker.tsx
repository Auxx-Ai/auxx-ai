// apps/web/src/components/kb/ui/articles/article-picker.tsx
'use client'

import type { ArticleKind } from '@auxx/database/types'
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
import { EntityIcon } from '@auxx/ui/components/icons'
import { ChevronRight, CornerDownRight } from 'lucide-react'
import { type KeyboardEvent, useCallback, useMemo, useState } from 'react'
import { useArticleList } from '../../hooks/use-article-list'
import { useKnowledgeBases } from '../../hooks/use-knowledge-bases'

interface NavItem {
  /** When `kind` is omitted, this entry is a KB root (cross-KB picker). */
  id: string
  label: string
  kind?: 'kb' | 'tab' | 'category'
}

export interface ArticlePickerProps {
  /**
   * KB to browse. If omitted, the picker shows a top-level KB list and
   * pushes a KB onto the navigation stack on select.
   */
  knowledgeBaseId?: string
  /** Article kinds the user is allowed to pick. */
  allowedKinds: ArticleKind[]
  /** Article kinds shown as drillable parents. */
  drillableKinds?: ArticleKind[]
  /** Article ids that are *not* valid choices. */
  forbiddenIds?: Set<string>
  /** Show a synthetic "Top of {tab}" entry inside a tab. */
  showTopOfTab?: boolean
  /** Highlight the article's current parent (move-picker shape). */
  currentParentId?: string | null
  /** Heading shown above the list (mirrors the breadcrumb root). */
  rootLabel?: string
  /** Placeholder for the search input. */
  searchPlaceholder?: string
  /**
   * When true, typing in the search input searches across all pickable
   * articles in the KB regardless of the current navigation level. Hierarchy
   * navigation still works when the search is empty.
   */
  flattenSearch?: boolean
  onPick: (articleId: string) => void
  onClose: () => void
}

const DEFAULT_DRILLABLE: ArticleKind[] = ['tab', 'category']

export function ArticlePicker(props: ArticlePickerProps) {
  return (
    <CommandNavigation<NavItem>>
      <ArticlePickerContent {...props} />
    </CommandNavigation>
  )
}

function ArticlePickerContent({
  knowledgeBaseId,
  allowedKinds,
  drillableKinds = DEFAULT_DRILLABLE,
  forbiddenIds,
  showTopOfTab,
  currentParentId,
  rootLabel = 'Pick an article',
  searchPlaceholder,
  flattenSearch,
  onPick,
  onClose,
}: ArticlePickerProps) {
  const { push, pop, isAtRoot, current, stack } = useCommandNavigation<NavItem>()
  const [search, setSearch] = useState('')
  const q = search.toLowerCase()

  // Cross-KB scope: when no `knowledgeBaseId` is provided, the root is a KB
  // list and we drill into a KB on select. Inside a KB, behave like the
  // single-KB form.
  const { knowledgeBases } = useKnowledgeBases()
  const activeKbId =
    knowledgeBaseId ??
    (stack[0]?.kind === 'kb' ? stack[0].id : isAtRoot ? null : (current?.id ?? null))

  const articles = useArticleList(activeKbId)

  const allowedSet = useMemo(() => new Set(allowedKinds), [allowedKinds])
  const drillableSet = useMemo(() => new Set(drillableKinds), [drillableKinds])

  const isPickable = useCallback(
    (kind: ArticleKind, id: string) => {
      if (!allowedSet.has(kind)) return false
      if (forbiddenIds?.has(id)) return false
      return true
    },
    [allowedSet, forbiddenIds]
  )

  const isDrillable = useCallback((kind: ArticleKind) => drillableSet.has(kind), [drillableSet])

  // Crossing-KB: stack[0] is the KB itself when knowledgeBaseId not set.
  const insideKb = activeKbId != null
  const inTabOrCat =
    current && (current.kind === 'tab' || current.kind === 'category') ? current : null
  const parentId = inTabOrCat?.id ?? null

  const visibleArticles = useMemo(() => {
    if (!insideKb) return []
    if (flattenSearch && q) {
      // Global search across the whole KB — only pickable articles, ignoring
      // the current navigation level. Drillable parents are excluded since
      // "drill into a tab" doesn't make sense in flat search results.
      return articles
        .filter((a) => isPickable(a.articleKind, a.id))
        .filter((a) => a.title.toLowerCase().includes(q))
        .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0))
    }
    return articles
      .filter((a) => {
        if (parentId == null) {
          // Root of the KB — show top-level entries (no parent).
          return a.parentId == null
        }
        return a.parentId === parentId
      })
      .filter((a) => isPickable(a.articleKind, a.id) || isDrillable(a.articleKind))
      .filter((a) => !q || a.title.toLowerCase().includes(q))
      .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0))
  }, [articles, insideKb, parentId, isPickable, isDrillable, q, flattenSearch])

  const visibleKbs = useMemo(() => {
    if (knowledgeBaseId || activeKbId) return []
    return knowledgeBases.filter((kb) => !q || (kb.name ?? '').toLowerCase().includes(q))
  }, [knowledgeBaseId, activeKbId, knowledgeBases, q])

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

  const placeholder =
    searchPlaceholder ??
    (current?.kind === 'tab' || current?.kind === 'category'
      ? `Search inside ${current.label}…`
      : insideKb
        ? 'Search articles…'
        : 'Search knowledge bases…')

  return (
    <Command className='w-72 overflow-hidden' shouldFilter={false} onKeyDown={handleKeyDown}>
      <CommandBreadcrumb rootLabel={rootLabel} />
      <CommandInput placeholder={placeholder} value={search} onValueChange={setSearch} />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        {!insideKb && visibleKbs.length > 0 && (
          <CommandGroup heading='Knowledge bases'>
            {visibleKbs.map((kb) => (
              <CommandItem
                key={kb.id}
                value={kb.name}
                onSelect={() => {
                  push({ id: kb.id, label: kb.name || 'Untitled', kind: 'kb' })
                  setSearch('')
                }}
                className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <EntityIcon iconId='book-open' size='xs' className='text-muted-foreground' />
                  <span>{kb.name || 'Untitled'}</span>
                </div>
                <ChevronRight className='size-4 opacity-50' />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {insideKb && (
          <CommandGroup
            heading={
              current?.kind === 'tab' || current?.kind === 'category' ? current.label : 'Articles'
            }>
            {showTopOfTab && inTabOrCat?.kind === 'tab' && (
              <CommandItem
                value={`top-${inTabOrCat.id}`}
                onSelect={() => onPick(inTabOrCat.id)}
                data-current={currentParentId === inTabOrCat.id || undefined}>
                <CornerDownRight className='mr-2 size-4 opacity-50' />
                <span>Top of {inTabOrCat.label}</span>
              </CommandItem>
            )}
            {visibleArticles.map((a) => {
              const drill = isDrillable(a.articleKind)
              const pick = isPickable(a.articleKind, a.id)
              const onSelect = () => {
                if (drill) {
                  push({
                    id: a.id,
                    label: a.title || 'Untitled',
                    kind: a.articleKind === 'tab' ? 'tab' : 'category',
                  })
                  setSearch('')
                  return
                }
                if (pick) onPick(a.id)
              }
              return (
                <CommandItem
                  key={a.id}
                  value={a.title || a.id}
                  onSelect={onSelect}
                  data-current={currentParentId === a.id || undefined}
                  className='flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <EntityIcon
                      iconId={a.emoji ?? articleKindIcon(a.articleKind)}
                      size='xs'
                      className='text-muted-foreground'
                    />
                    <span>{a.title || 'Untitled'}</span>
                  </div>
                  {drill ? <ChevronRight className='size-4 opacity-50' /> : null}
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}

function articleKindIcon(kind: ArticleKind): string {
  switch (kind) {
    case 'tab':
      return 'folder'
    case 'category':
      return 'folder-open'
    case 'header':
      return 'heading'
    case 'link':
      return 'link'
    default:
      return 'file-text'
  }
}
