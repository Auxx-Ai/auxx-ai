// apps/web/src/components/global/sidebar-secondary.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Command, CommandItem, CommandList } from '@auxx/ui/components/command'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  sidebarMenuButtonVariants,
} from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCommandPaletteStore } from '~/components/kbar/store'
import type { SidebarProps } from '~/constants/menu'
import { useSettingsMenu } from '~/hooks/use-settings-menu'
import {
  buildSettingsIndex,
  type SettingsSearchResult,
  searchSettings,
} from './sidebar-secondary-search'

type Props = { items: SidebarProps[]; baseUrl: string; title: string; current: string | undefined }

/** Below this many reachable pages the search field is more chrome than help. */
const SEARCH_MIN_ITEMS = 8

/**
 * Secondary (settings) navigation column, with iOS-Settings-style search.
 *
 * Two render states share one `Command` root: an unfiltered grouped nav of `<Link>`
 * rows, and — once the query is non-empty — a flat, keyboard-navigable result list.
 * The nav rows are deliberately NOT cmdk items: keeping them plain links preserves
 * cmd-click/middle-click and keeps `role='listbox'` off the always-visible nav.
 */
function SidebarSecondary({ items, baseUrl, title, current }: Props) {
  const router = useRouter()
  const groups = useSettingsMenu(items)
  const [query, setQuery] = useState('')
  // Mobile-only disclosure. Desktop ignores it via `md:` classes rather than a JS
  // breakpoint, so there is no first-render flash and no hydration mismatch.
  const [isOpen, setIsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const index = useMemo(() => buildSettingsIndex(groups, baseUrl), [groups, baseUrl])
  const results = useMemo(() => searchSettings(index, query), [index, query])

  const searchable = index.length >= SEARCH_MIN_ITEMS
  const isSearching = searchable && query.trim().length > 0

  const closeMobilePanel = useCallback(() => setIsOpen(false), [])

  const handleNavigate = useCallback(
    (href: string) => {
      router.push(href)
      setQuery('')
      setIsOpen(false)
    },
    [router]
  )

  // Focus search when the mobile panel expands. `isOpen` can only become true from
  // the `md:hidden` toggle, so this never steals focus on desktop.
  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      // First Escape clears the query, second blurs. Arrow keys and Enter bubble to
      // the `Command` root, which owns selection and scroll-into-view.
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (query) setQuery('')
      else inputRef.current?.blur()
    },
    [query]
  )

  return (
    <div className='flex flex-col md:h-full md:w-[16rem] md:shrink-0 md:border-r bg-neutral-50 dark:bg-sidebar text-sidebar-foreground'>
      {/* Mobile disclosure toggle */}
      <div className='sticky top-0 z-10 border-b border-neutral-200 dark:border-primary-200 bg-neutral-50 dark:bg-sidebar p-2 md:hidden'>
        <Button
          variant='ghost'
          className='w-full justify-between h-6 px-3'
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}>
          <span className='font-medium'>{title}</span>
          <ChevronDown className={cn('transition-transform', isOpen && 'rotate-180')} />
        </Button>
      </div>

      <Command
        shouldFilter={false}
        label={title}
        className={cn(
          // `h-auto` cancels the Command base's `h-full`, which would fight `flex-1`.
          'flex h-auto min-h-0 flex-1 flex-col overflow-hidden rounded-none bg-transparent',
          'transition-[max-height] duration-300 ease-in-out',
          // Desktop: always expanded. Mobile: driven by `isOpen`. `svh` so the
          // software keyboard doesn't bury the results.
          'md:max-h-none',
          isOpen ? 'max-h-[60svh]' : 'max-h-0'
        )}>
        {searchable && (
          <div className='shrink-0 p-2 pb-1'>
            <InputSearch
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery('')}
              onKeyDown={handleKeyDown}
              placeholder={`Search ${title.toLowerCase()}...`}
              role='combobox'
              aria-expanded={isSearching}
              aria-label={`Search ${title.toLowerCase()}`}
            />
          </div>
        )}

        {isSearching ? (
          <SearchResults
            results={results}
            query={query}
            onNavigate={handleNavigate}
            onItemClick={closeMobilePanel}
          />
        ) : (
          <ScrollArea
            className='relative min-h-0 flex-1'
            scrollbarClassName='w-1'
            fadeClassName='before:bg-gradient-to-b before:from-black/10 after:bg-gradient-to-t after:from-black/10'>
            {groups.map((group) => (
              <SidebarNavGroup
                key={group.id}
                group={group}
                baseUrl={baseUrl}
                current={current}
                onItemClick={closeMobilePanel}
              />
            ))}
          </ScrollArea>
        )}
      </Command>
    </div>
  )
}

/** One header group of the unfiltered nav. Plain links — never cmdk items. */
function SidebarNavGroup({
  group,
  baseUrl,
  current,
  onItemClick,
}: {
  group: SidebarProps
  baseUrl: string
  current: string | undefined
  onItemClick: () => void
}) {
  return (
    <div className='relative flex w-full min-w-0 flex-col p-2'>
      <div className='flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70'>
        {group.label}
      </div>
      <SidebarMenu className='gap-1'>
        {group.items?.map((item) => (
          <SidebarMenuItem key={item.id}>
            <SidebarMenuButton
              asChild
              variant='secondary'
              size='compact'
              isActive={item.slug === current}>
              <Link href={`${baseUrl}/${item.slug}`} prefetch={false} onClick={onItemClick}>
                {item.icon}
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </div>
  )
}

/**
 * Flat result list. Rows stay real anchors so cmd-click still opens a new tab:
 * cmdk fires `onSelect` from a custom event on Enter (never a synthetic click), while
 * `stopPropagation` keeps its `onClick` handler out of the way of the anchor.
 */
function SearchResults({
  results,
  query,
  onNavigate,
  onItemClick,
}: {
  results: SettingsSearchResult[]
  query: string
  onNavigate: (href: string) => void
  onItemClick: () => void
}) {
  const openPalette = useCommandPaletteStore((state) => state.openPalette)

  if (results.length === 0) {
    return (
      <div className='flex min-h-0 flex-1 flex-col gap-2 p-3'>
        <p className='text-sm text-muted-foreground'>
          No settings match &ldquo;{query.trim()}&rdquo;
        </p>
        <Button variant='outline' size='sm' className='justify-start' onClick={openPalette}>
          Search everything
        </Button>
      </div>
    )
  }

  return (
    <CommandList scrollAreaClassName='min-h-0 flex-1 max-h-none' className='p-2'>
      {results.map((result) => (
        <CommandItem
          key={result.item.id}
          value={result.item.id}
          onSelect={() => onNavigate(result.href)}
          className={cn(
            sidebarMenuButtonVariants({ variant: 'secondary', size: 'compact' }),
            'h-auto min-h-7 rounded-md py-1.5',
            'data-[selected=true]:ring-1 data-[selected=true]:ring-inset data-[selected=true]:ring-primary-300',
            'data-[selected=true]:bg-black/5 dark:data-[selected=true]:bg-sidebar-accent'
          )}>
          <Link
            href={result.href}
            prefetch={false}
            onClick={(event) => {
              // Let the anchor own every click (incl. cmd/middle) — keep cmdk's
              // onClick handler from double-navigating.
              event.stopPropagation()
              onItemClick()
            }}
            className='flex min-w-0 flex-1 items-center gap-2'>
            {result.item.icon}
            {/* The cva's `[&>span:last-child]:truncate` targets DIRECT span children,
                so the label needs its own explicit `truncate` inside this wrapper. */}
            <span className='flex min-w-0 flex-1 flex-col'>
              <span className='truncate'>
                <HighlightedLabel label={result.item.label} match={result.labelMatch} />
              </span>
              <span className='truncate text-xs text-muted-foreground'>
                {result.item.description ?? result.groupLabel}
              </span>
            </span>
          </Link>
        </CommandItem>
      ))}
    </CommandList>
  )
}

/** Bolds the matched span of a label, when the hit was in the label itself. */
function HighlightedLabel({ label, match }: { label: string; match: [number, number] | null }) {
  if (!match) return <>{label}</>
  const [start, end] = match
  return (
    <>
      {label.slice(0, start)}
      <mark className='bg-transparent font-semibold text-foreground'>
        {label.slice(start, end)}
      </mark>
      {label.slice(end)}
    </>
  )
}

export default SidebarSecondary
