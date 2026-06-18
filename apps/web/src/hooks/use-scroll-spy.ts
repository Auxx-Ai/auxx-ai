// apps/web/src/hooks/use-scroll-spy.ts

'use client'

import { useCallback, useEffect, useRef } from 'react'

interface UseScrollSpyOptions<K extends string> {
  /** Section keys in DOM order, top → bottom. */
  sections: readonly K[]
  /** The currently active key (owned externally — nuqs / useState / store). */
  active: K
  /** Fired when scrolling activates a different section. */
  onActiveChange: (key: K) => void
  /** Bump to re-bind the scroll listener after the viewport remounts. */
  remountKey?: unknown
  /** Activate a section once it crosses this many px past the viewport top. */
  spyBuffer?: number
  /** Offset applied when scrolling a section to the top. */
  scrollBuffer?: number
}

interface UseScrollSpyResult<K extends string> {
  /** Attach to the scrollable viewport (e.g. `ScrollArea` viewportRef). */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  /** Attach to each section wrapper: `ref={assignRef('prompt')}`. */
  assignRef: (key: K) => (el: HTMLDivElement | null) => void
  /** Scroll a section to the top (e.g. a tab onClick). */
  scrollToSection: (key: K) => void
}

/**
 * Generic scroll-spy for a single scrollable column whose sections map to a tab
 * strip. Clicking a tab scrolls the matching section into view; scrolling
 * updates the active key via `onActiveChange`.
 *
 * The hook is agnostic to where active state lives — the caller passes `active`
 * and `onActiveChange`. The active key is held in a ref so the scroll listener
 * does not re-subscribe on every activation; it only re-binds when `remountKey`
 * changes (the viewport is recreated, e.g. on return from a drill panel).
 */
export function useScrollSpy<K extends string>({
  sections,
  active,
  onActiveChange,
  remountKey,
  spyBuffer = 8,
  scrollBuffer = 0,
}: UseScrollSpyOptions<K>): UseScrollSpyResult<K> {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const sectionRefs = useRef<Partial<Record<K, HTMLDivElement | null>>>({})
  const isProgrammaticScrollRef = useRef(false)

  // Hold the active key + section list + callback in refs so the scroll listener
  // reads the latest values without re-subscribing on every change.
  const activeRef = useRef(active)
  activeRef.current = active
  const sectionsRef = useRef(sections)
  sectionsRef.current = sections
  const onActiveChangeRef = useRef(onActiveChange)
  onActiveChangeRef.current = onActiveChange

  const assignRef = useCallback(
    (key: K) => (el: HTMLDivElement | null) => {
      sectionRefs.current[key] = el
    },
    []
  )

  const scrollToSection = useCallback(
    (key: K) => {
      const target = sectionRefs.current[key]
      const container = scrollContainerRef.current
      if (!target || !container) return
      isProgrammaticScrollRef.current = true
      const targetRect = target.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      container.scrollTo({
        top: container.scrollTop + (targetRect.top - containerRect.top) - scrollBuffer,
        behavior: 'smooth',
      })
      window.setTimeout(() => {
        isProgrammaticScrollRef.current = false
      }, 700)
    },
    [scrollBuffer]
  )

  // Scroll-spy: as the user scrolls, activate whichever section is closest to the
  // top of the viewport. Re-binds only when `remountKey` changes (bump it to
  // re-bind the listener to the new viewport after the ScrollArea remounts).
  // biome-ignore lint/correctness/useExhaustiveDependencies: remountKey is a re-bind trigger, not a value read inside the effect
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    let raf = 0

    const onScroll = () => {
      if (isProgrammaticScrollRef.current) return
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const containerRect = container.getBoundingClientRect()
        const activationY = containerRect.top + spyBuffer
        let best: K | null = null
        for (const key of sectionsRef.current) {
          const el = sectionRefs.current[key]
          if (!el) continue
          const rect = el.getBoundingClientRect()
          if (rect.top <= activationY) best = key
        }
        if (best && best !== activeRef.current) {
          activeRef.current = best
          onActiveChangeRef.current(best)
        }
      })
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [spyBuffer, remountKey])

  return { scrollContainerRef, assignRef, scrollToSection }
}
