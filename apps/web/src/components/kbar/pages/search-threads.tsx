// apps/web/src/components/kbar/pages/search-threads.tsx
'use client'

import { buildConditionGroups } from '@auxx/lib/mail-query/client'
import { Button } from '@auxx/ui/components/button'
import { Kbd, KbdGroup } from '@auxx/ui/components/kbd'
import { ScrollArea, scrollElementIntoViewport } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useHotkeys } from '@tanstack/react-hotkeys'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInView } from 'react-intersection-observer'
import { useThreadList } from '~/components/threads/hooks/use-thread-list'
import { useCommandPaletteStore } from '../store'
import { threadHref } from '../thread-href'
import { PaletteThreadRow } from '../thread-search/palette-thread-row'
import { PaletteThreadSearchBar } from '../thread-search/palette-thread-search-bar'
import { usePaletteThreadSearchStore } from '../thread-search/store'
import { ThreadPreview } from './thread-preview'

/**
 * Thread reader page: the inbox's reading experience inside the command palette.
 * The left pane is the real mail searchbar (isolated palette store) above a
 * thread results list across *all* inboxes/statuses; the right pane renders the
 * selected thread's messages read-only via {@link ThreadPreview}. Selection is
 * click-driven; Enter (when the searchbar didn't consume it) or "Open in mail"
 * navigates to the thread in the inbox and closes the palette.
 */
export function SearchThreadsPage() {
  const router = useRouter()
  const close = useCommandPaletteStore((s) => s.close)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const resultsViewportRef = useRef<HTMLDivElement>(null)

  // Searchbar conditions drive the list reactively (field conditions live;
  // free-text lands as a `freeText` condition on Enter — shell behavior).
  const conditions = usePaletteThreadSearchStore((s) => s.conditions)
  const filter = useMemo(
    // Scope = "all": contextType 'all' + no status yields only the default
    // TRASH/SPAM/IGNORED exclusion, so every inbox/status is in range.
    () => buildConditionGroups({ contextType: 'all', statusSlug: undefined }, conditions),
    [conditions]
  )

  const { threads, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useThreadList({
    filter,
    sort: { field: 'lastMessageAt', direction: 'desc' },
  })

  // Focus the searchbar on entry — DialogNav swaps pages without re-running
  // Radix's open autofocus, so the input is otherwise unfocused and ↑/↓ / typing
  // do nothing until the user clicks. Defer past the page transition.
  useEffect(() => {
    const id = setTimeout(() => containerRef.current?.querySelector('input')?.focus(), 60)
    return () => clearTimeout(id)
  }, [])

  // Auto-select the first result so the right pane is never blank. Keep the
  // current selection if it's still in the results; otherwise fall back to first.
  useEffect(() => {
    if (threads.length === 0) return
    if (!selectedThreadId || !threads.some((t) => t.id === selectedThreadId)) {
      setSelectedThreadId(threads[0]!.id)
    }
  }, [threads, selectedThreadId])

  // Infinite scroll: a bottom sentinel auto-loads the next page when it scrolls
  // into view, same as the inbox list (IntersectionObserver clips through the
  // ScrollArea's overflow, so no explicit root is needed).
  const { ref: sentinelRef, inView } = useInView({ threshold: 0 })
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage])

  const openInMail = useCallback(
    (threadId: string) => {
      router.push(threadHref({ id: threadId }))
      close()
    },
    [router, close]
  )

  // Move keyboard focus to the row at `index`, which selects it (the row's
  // onFocus drives the preview), scrolls it into view, and pre-fetches the next
  // page as the cursor approaches the end of the list.
  const focusRowAt = useCallback(
    (index: number) => {
      const thread = threads[index]
      if (!thread) return
      const el = document.getElementById(`palette-thread-${thread.id}`)
      el?.focus({ preventScroll: true })
      if (el && resultsViewportRef.current) {
        scrollElementIntoViewport(el, resultsViewportRef.current, {
          behavior: 'smooth',
          padding: 96,
        })
      }
      if (index >= threads.length - 3 && hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    },
    [threads, hasNextPage, isFetchingNextPage, fetchNextPage]
  )

  // Index of the currently focused row, or -1 when focus is elsewhere (e.g. the
  // searchbar input) — the entry point for `↓` to step into the list.
  const focusedRowIndex = useCallback(() => {
    const activeId = document.activeElement?.id
    if (!activeId?.startsWith('palette-thread-')) return -1
    return threads.findIndex((t) => `palette-thread-${t.id}` === activeId)
  }, [threads])

  /** Return the SearchBarShell currently holding focus inside this palette page. */
  const focusedSearchbar = useCallback(() => {
    const activeElement = document.activeElement
    if (!(activeElement instanceof HTMLElement)) return null

    const searchbar = activeElement.closest<HTMLElement>('[data-searchbar-shell]')
    if (!searchbar || !containerRef.current?.contains(searchbar)) return null

    return searchbar
  }, [])

  // TanStack hotkeys attach native listeners, which may run before React's input
  // keydown handler. Read SearchBarShell's data attributes instead of relying
  // only on `defaultPrevented` so suggestions keep ownership while the user is
  // actively typing/filtering, but an empty focused searchbar can hand ↓ to rows.
  const shouldLetSearchbarOwnArrow = useCallback(() => {
    const searchbar = focusedSearchbar()
    if (!searchbar) return false

    const isOpen = searchbar.dataset.searchbarOpen === 'true'
    const inputIsEmpty = searchbar.dataset.searchbarInputEmpty === 'true'
    const suggestionsCount = Number(searchbar.dataset.searchbarSuggestionsCount ?? 0)
    const highlightedIndex = Number(searchbar.dataset.searchbarHighlightedIndex ?? -1)

    return isOpen && suggestionsCount > 0 && (!inputIsEmpty || highlightedIndex >= 0)
  }, [focusedSearchbar])

  /** Move the palette result cursor up or down from scoped TanStack hotkeys. */
  const handleArrowNavigation = useCallback(
    (event: KeyboardEvent, direction: 'up' | 'down') => {
      if (event.defaultPrevented || shouldLetSearchbarOwnArrow()) return

      event.preventDefault()
      event.stopPropagation()

      const idx = focusedRowIndex()
      if (direction === 'down') {
        focusRowAt(idx < 0 ? 0 : Math.min(idx + 1, threads.length - 1))
        return
      }

      if (idx <= 0) {
        // From the top of the list, hand focus back to the searchbar input.
        containerRef.current?.querySelector('input')?.focus()
      } else {
        focusRowAt(idx - 1)
      }
    },
    [focusedRowIndex, focusRowAt, shouldLetSearchbarOwnArrow, threads.length]
  )

  useHotkeys(
    [
      {
        hotkey: 'ArrowDown',
        callback: (event: KeyboardEvent) => handleArrowNavigation(event, 'down'),
      },
      {
        hotkey: 'ArrowUp',
        callback: (event: KeyboardEvent) => handleArrowNavigation(event, 'up'),
      },
      {
        hotkey: 'Enter',
        callback: (event: KeyboardEvent) => {
          if (event.defaultPrevented || focusedSearchbar() || !selectedThreadId) return
          event.preventDefault()
          event.stopPropagation()
          openInMail(selectedThreadId)
        },
      },
    ],
    {
      target: containerRef,
      enabled: threads.length > 0,
      ignoreInputs: false,
      preventDefault: false,
      stopPropagation: false,
      conflictBehavior: 'allow',
    }
  )

  return (
    <div ref={containerRef} className='flex min-h-0 flex-col max-sm:h-full'>
      <div className='border-b border-border/50 p-2 dark:border-[#323842]/80'>
        <PaletteThreadSearchBar onSearch={() => {}} isLoading={isLoading} />
      </div>

      <div className='flex h-[min(420px,60vh)] max-sm:h-auto max-sm:min-h-0 max-sm:flex-1'>
        {/* Left: thread results */}
        <div className='flex w-full flex-col overflow-hidden border-border/50 md:w-[22rem] md:flex-none md:border-r dark:border-[#323842]/80'>
          <ScrollArea
            viewportRef={resultsViewportRef}
            className='min-h-0 flex-1'
            scrollbarClassName='w-1!'>
            <div className='flex flex-col gap-1 p-2 pe-4'>
              {isLoading && threads.length === 0 ? (
                <>
                  <ThreadRowSkeleton />
                  <ThreadRowSkeleton />
                  <ThreadRowSkeleton />
                </>
              ) : threads.length === 0 ? (
                <div className='p-6 text-center text-sm text-primary-400'>No threads found.</div>
              ) : (
                <>
                  {threads.map((thread) => (
                    <PaletteThreadRow
                      key={thread.id}
                      thread={thread}
                      isSelected={thread.id === selectedThreadId}
                      onSelect={() => setSelectedThreadId(thread.id)}
                    />
                  ))}
                  {(hasNextPage || isFetchingNextPage) && (
                    <div ref={sentinelRef} className='flex h-8 w-full items-center justify-center'>
                      {isFetchingNextPage && (
                        <Loader2 className='size-4 animate-spin text-muted-foreground' />
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right: read-only message view */}
        <ThreadPreview threadId={selectedThreadId} />
      </div>

      <div className='flex h-11 items-center gap-4 border-t border-border/50 px-3 text-xs text-muted-foreground dark:border-[#323842]/80'>
        <span className='flex items-center gap-1'>
          <KbdGroup variant='ghost' size='sm'>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
          </KbdGroup>
          Navigate
        </span>
        {selectedThreadId && (
          <Button
            variant='default'
            size='xs'
            className='ml-auto'
            onClick={() => openInMail(selectedThreadId)}>
            Open in mail
            <Kbd shortcut='enter' variant='default' size='sm' />
          </Button>
        )}
      </div>
    </div>
  )
}

/** Lightweight loading skeleton for a palette thread row. */
function ThreadRowSkeleton() {
  return (
    <div className='flex w-full flex-col gap-2 rounded-lg border bg-background px-3 py-2.5'>
      <div className='flex items-center justify-between'>
        <Skeleton className='h-4 w-1/3' />
        <Skeleton className='h-3 w-10' />
      </div>
      <Skeleton className='h-3 w-2/3' />
      <Skeleton className='h-3 w-full' />
    </div>
  )
}
