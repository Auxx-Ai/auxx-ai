// apps/web/src/components/global/infinite-list-tail.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { useEffect, useRef } from 'react'

/**
 * Consecutive pages the sentinel may pull without the reader scrolling again.
 *
 * The sentinel sits at the end of the list, so a page that does not fill the
 * viewport leaves it still on screen and it fires straight away. That is right
 * once or twice - a short first page catching up to a tall window - but
 * unbounded it walks the whole queue on mount. Reset on scroll.
 */
const MAX_AUTO_FETCHES = 5

interface InfiniteListTailProps {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => unknown
  /** `Loading more payouts...` - the noun is the list's. */
  loadingLabel?: string
}

/** The nearest ancestor that scrolls vertically, or `null` for the window. */
function scrollRootOf(node: HTMLElement): HTMLElement | null {
  let el = node.parentElement
  while (el) {
    const { overflowY } = getComputedStyle(el)
    if (overflowY === 'auto' || overflowY === 'scroll') return el
    el = el.parentElement
  }
  return null
}

/**
 * The end of an infinite list: a sentinel the scroll root observes to pull the
 * next page, a loading line while it arrives, and a Load more button for when
 * the auto-fetch budget runs out - which only happens on a viewport the pages
 * do not fill, exactly when there is nothing to scroll to reset it.
 */
export function InfiniteListTail({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  loadingLabel = 'Loading more...',
}: InfiniteListTailProps) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  // Refs rather than deps so the observer is built once, not after every fetch.
  const nextPage = useRef({ fetch: fetchNextPage, has: false, fetching: false })
  nextPage.current = { fetch: fetchNextPage, has: hasNextPage, fetching: isFetchingNextPage }
  const autoFetches = useRef(0)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const root = scrollRootOf(sentinel)
    const scrollTarget: HTMLElement | Window = root ?? window

    const reset = () => {
      autoFetches.current = 0
    }
    scrollTarget.addEventListener('scroll', reset, { passive: true })

    const observer = new IntersectionObserver(
      ([entry]) => {
        const { has, fetching, fetch } = nextPage.current
        if (!entry?.isIntersecting || !has || fetching) return
        if (autoFetches.current >= MAX_AUTO_FETCHES) return
        autoFetches.current++
        void fetch()
      },
      { root, threshold: 0 }
    )
    observer.observe(sentinel)

    return () => {
      scrollTarget.removeEventListener('scroll', reset)
      observer.disconnect()
    }
  }, [])

  return (
    <>
      <div ref={sentinelRef} className='h-px shrink-0' aria-hidden />
      {isFetchingNextPage && (
        <div className='py-3 text-center text-muted-foreground text-xs'>{loadingLabel}</div>
      )}
      {hasNextPage && !isFetchingNextPage && (
        <div className='flex justify-center py-3'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => {
              autoFetches.current = 0
              void fetchNextPage()
            }}>
            Load more
          </Button>
        </div>
      )}
    </>
  )
}
