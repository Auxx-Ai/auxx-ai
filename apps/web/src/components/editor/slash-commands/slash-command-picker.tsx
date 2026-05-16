// apps/web/src/components/editor/slash-commands/slash-command-picker.tsx
'use client'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import { ChevronRight } from 'lucide-react'
import { useCallback, useMemo, useRef } from 'react'

/** Minimal shape every slash-menu item satisfies. Sections can extend it. */
export interface SlashCommandItem {
  id: string
  title: string
  description?: string
  keywords?: string[]
  iconId?: string
  /** Renders a chevron and is the cue for ArrowRight to trigger
   *  `onArrowRight`. The shell never owns *what* drill-down does. */
  drillDown?: boolean
}

export interface SlashCommandSection<TItem extends SlashCommandItem = SlashCommandItem> {
  id: string
  heading?: string
  items: TItem[]
  onSelect: (item: TItem) => void
  /** Return `true` to consume the ArrowRight event. */
  onArrowRight?: (item: TItem) => boolean
  /** Override the default `iconId + title + drillDown chevron` row. */
  renderItem?: (item: TItem) => React.ReactNode
  /** cmdk value override — defaults to `item.title`. Use a stable, unique
   *  value for items whose titles may collide with each other (e.g. user
   *  snippet titles colliding with command titles). */
  itemValue?: (item: TItem) => string
}

export interface SlashCommandPickerProps {
  /** External query coming from the suggestion plugin. The shell does not
   *  read this — it's part of the contract so composers can sync their
   *  controlled `searchQuery` when they choose to. */
  query: string
  searchQuery: string
  setSearchQuery: (q: string) => void
  onClose: () => void
  sections: SlashCommandSection<SlashCommandItem>[]
  /** Slot above the search input — KB passes `<CommandBreadcrumb>` here. */
  header?: React.ReactNode
  placeholder?: string
  /** Overrides the default "No results found." */
  emptyMessage?: string
  /** Called when Backspace fires at empty input. Return `true` if consumed;
   *  if not consumed, the shell closes the picker. */
  onBackspaceEmpty?: () => boolean
  /** Called when ArrowLeft fires at empty input. Return `true` if consumed;
   *  if not consumed, the shell does nothing (ArrowLeft is a no-op by
   *  default). */
  onArrowLeftEmpty?: () => boolean
  /** Suppress the "No results" / sections render — composer is still loading. */
  loading?: boolean
}

const DEFAULT_PLACEHOLDER = 'Type a command or search...'
const DEFAULT_EMPTY = 'No results found.'

function defaultMatches(item: SlashCommandItem, q: string): boolean {
  if (!q) return true
  if (item.title.toLowerCase().includes(q)) return true
  if (item.description?.toLowerCase().includes(q)) return true
  if (item.keywords?.some((kw) => kw.toLowerCase().includes(q))) return true
  return false
}

/**
 * Generic slash-menu shell. Knows nothing about snippets / placeholders /
 * article-links — sections own click + ArrowRight behavior, the shell only
 * owns the chrome (input, list, keyboard handling, filtering, empty state).
 */
export function SlashCommandPicker({
  searchQuery,
  setSearchQuery,
  onClose,
  sections,
  header,
  placeholder = DEFAULT_PLACEHOLDER,
  emptyMessage = DEFAULT_EMPTY,
  onBackspaceEmpty,
  onArrowLeftEmpty,
  loading = false,
}: SlashCommandPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const q = searchQuery.toLowerCase()

  const filteredSections = useMemo(
    () =>
      sections.map((section) => ({
        section,
        items: section.items.filter((item) => defaultMatches(item, q)),
      })),
    [sections, q]
  )

  const allEmpty = filteredSections.every(({ items }) => items.length === 0)

  // Maps the currently selected cmdk `data-value` back to the originating
  // section + item so `onArrowRight` can dispatch without each section having
  // to scan its own items.
  const itemLookup = useMemo(() => {
    const map = new Map<string, { section: SlashCommandSection; item: SlashCommandItem }>()
    for (const { section, items } of filteredSections) {
      for (const item of items) {
        const value = section.itemValue?.(item) ?? item.title
        map.set(value.toLowerCase(), { section, item })
      }
    }
    return map
  }, [filteredSections])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'Backspace' && !searchQuery) {
        if (onBackspaceEmpty?.()) {
          e.preventDefault()
          return
        }
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowLeft' && !searchQuery) {
        if (onArrowLeftEmpty?.()) {
          e.preventDefault()
        }
        return
      }
      if (e.key === 'ArrowRight') {
        const selected = (e.currentTarget as HTMLElement).querySelector<HTMLElement>(
          '[cmdk-item][data-selected="true"]'
        )
        const value = selected?.getAttribute('data-value')
        if (!value) return
        const entry = itemLookup.get(value.toLowerCase())
        if (!entry) return
        if (entry.section.onArrowRight?.(entry.item)) {
          e.preventDefault()
        }
      }
    },
    [searchQuery, onBackspaceEmpty, onArrowLeftEmpty, onClose, itemLookup]
  )

  return (
    <Command className='w-72 overflow-hidden' shouldFilter={false} onKeyDown={handleKeyDown}>
      {header}
      <CommandInput
        ref={inputRef}
        placeholder={placeholder}
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList>
        {loading && <CommandEmpty>Loading...</CommandEmpty>}
        {!loading && allEmpty && <CommandEmpty>{emptyMessage}</CommandEmpty>}
        {!loading &&
          filteredSections.map(({ section, items }) => {
            if (items.length === 0) return null
            return (
              <CommandGroup key={section.id} heading={section.heading}>
                {items.map((item) => {
                  const value = section.itemValue?.(item) ?? item.title
                  return (
                    <CommandItem
                      key={item.id}
                      value={value}
                      onSelect={() => section.onSelect(item)}
                      className='flex items-center justify-between'>
                      {section.renderItem ? (
                        section.renderItem(item)
                      ) : (
                        <DefaultItemContent item={item} />
                      )}
                      {item.drillDown && <ChevronRight className='size-4 opacity-50' />}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )
          })}
      </CommandList>
    </Command>
  )
}

function DefaultItemContent({ item }: { item: SlashCommandItem }) {
  return (
    <div className='flex items-center gap-2'>
      {item.iconId && (
        <EntityIcon iconId={item.iconId} size='xs' className='text-muted-foreground' />
      )}
      <span>{item.title}</span>
    </div>
  )
}
