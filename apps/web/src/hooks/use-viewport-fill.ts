// apps/web/src/hooks/use-viewport-fill.ts

'use client'

import { type RefObject, useLayoutEffect, useState } from 'react'

/** No frame is filled below this, however short the viewport is. */
const DEFAULT_MIN_HEIGHT = 200

/**
 * The height that makes `ref`'s element end exactly where its surrounding
 * `ScrollArea` viewport does, in px - or `undefined` until the first measure.
 *
 * ## Why a page inside `SettingsPage` needs this at all
 *
 * `SettingsPage` IS a `ScrollArea`. Its content wrapper is `min-h-full` with an
 * **auto** height, and `flex-1` does not cap a child of an auto-height flex
 * column: per flexbox, a grow item's max-content contribution is what sizes the
 * container, so `flex min-h-0 flex-1` grows to the list instead of to the
 * viewport. A nested `ScrollArea` inside it then gets a root as tall as its own
 * content, never scrolls, and the OUTER viewport scrolls the whole page - two
 * scroll areas where only the inner one was meant to move. A definite pixel
 * height on the frame is what makes the inner scroller a scroller.
 *
 * ⚠️ `--settings-sticky-top` is not the whole offset. It measures the sticky
 * title/tabs block only; the breadcrumb bar above it is a separate, non-sticky
 * sibling, so `viewportHeight - stickyTop` overshoots by the breadcrumb's height
 * and the page gains a scrollbar exactly that tall. What is honest is the
 * element's own offset inside the scroll content - everything above it, sticky
 * or not, has already been laid out.
 */
export function useViewportFill(
  ref: RefObject<HTMLElement | null>,
  minHeight: number = DEFAULT_MIN_HEIGHT
): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const viewport = el.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (!viewport) return

    const measure = () => {
      const offset =
        el.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
      setHeight(Math.max(minHeight, viewport.clientHeight - offset))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    // Everything laid out above the frame - the breadcrumb bar and the sticky
    // header, both of which grow a line when a description wraps at narrow
    // widths, and neither of which resizes the viewport when it happens. Never
    // the frame itself nor an ancestor of it: this effect sets that height, so
    // observing it would loop.
    for (const sibling of viewport.firstElementChild?.children ?? []) {
      if (!sibling.contains(el)) observer.observe(sibling)
    }
    return () => observer.disconnect()
  }, [ref, minHeight])

  return height
}
