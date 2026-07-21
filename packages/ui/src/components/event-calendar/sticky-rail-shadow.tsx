// packages/ui/src/components/event-calendar/sticky-rail-shadow.tsx

'use client'

/**
 * Right-edge drop shadow for a calendar stream's sticky-left rail (the week/day hour gutter,
 * the timeline's worker rail) — the dynamic table's pinned-column shadow recipe
 * (`virtual-table-body.tsx`), minus its scroll-state opacity logic: the calendar streams sit
 * mid-stream at all times, so the shadow is ALWAYS on. A 1px strip hugging the parent's right
 * edge whose box-shadow is clip-path'd to cast rightward only, over the scrolling grid.
 * The parent must be positioned (the sticky rails all are).
 */
export function StickyRailShadow() {
  return (
    <div
      aria-hidden
      className='pointer-events-none absolute inset-y-0 left-full -ml-px w-px bg-transparent shadow-[6px_0_16px_4px_rgb(0,0,0,0.2)] dark:shadow-[6px_0_16px_4px_rgb(0,0,0,0.9)] [clip-path:inset(0px_-38px_0px_0px)]'
    />
  )
}
