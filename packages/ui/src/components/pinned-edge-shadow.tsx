// packages/ui/src/components/pinned-edge-shadow.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { type RefObject, useEffect, useRef } from 'react'

export interface PinnedEdgeShadowProps {
  /** The element that scrolls horizontally. */
  scrollRef: RefObject<HTMLElement | null>
  /** Right edge of the pinned column(s), in px or any CSS length. */
  left: number | string
  /** Full height to cover, usually the scroll content's height. */
  height: number | string
  /** How far the shadow reaches up over a sticky header above it. */
  headerOffset?: number
  className?: string
}

/**
 * The shadow beside a pinned column, faded in over the first 50px of horizontal
 * scroll. Same look as the dynamic table's; opacity is written straight to the
 * DOM so scrolling never re-renders.
 */
export function PinnedEdgeShadow({
  scrollRef,
  left,
  height,
  headerOffset = 0,
  className,
}: PinnedEdgeShadowProps) {
  const shadowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const update = () => {
      if (shadowRef.current) {
        shadowRef.current.style.opacity = String(Math.min(scroller.scrollLeft / 50, 1))
      }
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    return () => scroller.removeEventListener('scroll', update)
  }, [scrollRef])

  return (
    <div
      aria-hidden
      className={cn('pointer-events-none sticky top-0 z-20 w-0 max-sm:hidden', className)}
      style={{ left, height }}>
      <div
        ref={shadowRef}
        className='absolute bottom-0 left-full ml-[-1px] w-px bg-transparent opacity-0 shadow-[6px_0_16px_4px_rgb(0,0,0,0.2)] transition-opacity duration-200 [clip-path:inset(0px_-38px_0px_0px)] dark:shadow-[6px_0_16px_4px_rgb(0,0,0,0.9)]'
        style={{ top: -headerOffset }}
      />
    </div>
  )
}
