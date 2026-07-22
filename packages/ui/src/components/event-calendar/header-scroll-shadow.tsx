// packages/ui/src/components/event-calendar/header-scroll-shadow.tsx

'use client'

/**
 * Soft drop shadow hanging below a calendar view's sticky header, visible only once the grid is
 * scrolled down — the sidebar ScrollArea's top-fade recipe, minus the hairline (the headers keep
 * their own always-on `border-b`). Renders inside the sticky header at `top-full`, so it spans the
 * full content width — hour gutter / worker rail included — and rides above the z-20 sticky rails.
 *
 * Visibility is driven by a `data-scrolled-y` attribute on the scroll container (which must carry
 * `group/grid-scroll`), mirrored render-free from `scrollTop` via `syncScrolledY` in the view's
 * scroll handler.
 */
export function HeaderScrollShadow() {
  return (
    <div
      aria-hidden
      className='pointer-events-none absolute inset-x-0 top-full h-2 bg-gradient-to-b from-black/10 to-transparent opacity-0 transition-opacity duration-150 ease-out group-data-[scrolled-y]/grid-scroll:opacity-100'
    />
  )
}

/** Mirrors `scrollTop > 0` onto the scroll element as `data-scrolled-y` — call on every scroll. */
export function syncScrolledY(el: HTMLElement) {
  el.toggleAttribute('data-scrolled-y', el.scrollTop > 0)
}
