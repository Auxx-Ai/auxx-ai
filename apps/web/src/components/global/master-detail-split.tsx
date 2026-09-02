// apps/web/src/components/global/master-detail-split.tsx
'use client'

import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { cn } from '@auxx/ui/lib/utils'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMedia } from '~/hooks/use-media'

const STORAGE_PREFIX = 'master-detail-width'

/** Below this the split collapses to one column and the detail moves into a drawer. */
const DESKTOP_QUERY = '(min-width: 1024px)'

/**
 * The list never gets narrower than this on desktop, whatever the pane asks for.
 * A 720px pane in a 1100px window would otherwise leave the list a sliver.
 */
const MIN_LIST_WIDTH = 360

type MasterDetailSplitProps = {
  /**
   * Stable id for this split. Used as the localStorage key for the user's pane
   * width, so it must not collide with another page's split.
   */
  id: string
  /** The master column: the list. */
  children: React.ReactNode
  /** The detail column: the editor/preview. Also the drawer body below `lg`. */
  pane: React.ReactNode
  /**
   * Drawer title below `lg`. Omit to skip the drawer entirely — the detail then
   * only exists on desktop (e.g. a preview pane with its own mobile affordance).
   */
  paneTitle?: string
  /** Whether the detail is open. Only drives the drawer; desktop always renders `pane`. */
  paneOpen?: boolean
  /** Called when the drawer is dismissed. Clear the selection here. */
  onPaneClose?: () => void
  /** Pane width in px before the user drags it. */
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
  /**
   * How the split scrolls.
   * - `'page'` (default): the page scrolls and the pane pins under `SettingsPage`'s
   *   sticky header. Requires a `SettingsPage` ancestor to publish the offsets.
   * - `'columns'`: fixed-height row, each column scrolls on its own. For splits
   *   outside `SettingsPage` (e.g. inside `MainPageContent`), where there is no
   *   page-level scroll container for a sticky child to travel in.
   */
  scroll?: 'page' | 'columns'
  className?: string
}

/**
 * The list-plus-editor split used by every master-detail settings screen: a wide
 * list, a resizable detail pane on the right, and the same pane as a drawer on
 * mobile.
 *
 * Drag the divider to resize; the width persists per `id`. Double-click resets it.
 * The pane never pushes the list below `MIN_LIST_WIDTH`: a stored width that no
 * longer fits the window is capped, not applied.
 *
 * @example
 * <MasterDetailSplit
 *   id='tariff-codes'
 *   pane={editorContent}
 *   paneTitle='Tariff code'
 *   paneOpen={!!selectedId}
 *   onPaneClose={() => setSelectedId(null)}>
 *   <TariffCodesList … />
 * </MasterDetailSplit>
 */
export function MasterDetailSplit({
  id,
  children,
  pane,
  paneTitle,
  paneOpen = false,
  onPaneClose,
  defaultWidth = 420,
  minWidth = 320,
  maxWidth = 720,
  scroll = 'page',
  className,
}: MasterDetailSplitProps) {
  const isDesktop = useMedia(DESKTOP_QUERY)
  const containerRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef<HTMLDivElement>(null)
  // Whether the pane fits under the settings header. A sticky element taller than
  // the room it has pins its top and buries its bottom until the list runs out,
  // so a pane that does not fit is left in the flow and scrolls with the page.
  const [paneFits, setPaneFits] = useState(true)
  useEffect(() => {
    const el = stickyRef.current
    if (scroll !== 'page' || !el) return
    const check = () => {
      const styles = getComputedStyle(el)
      const viewportH =
        Number.parseFloat(styles.getPropertyValue('--settings-viewport-h')) || window.innerHeight
      const top = Number.parseFloat(styles.getPropertyValue('--settings-sticky-top')) || 0
      setPaneFits(el.offsetHeight <= viewportH - top)
    }
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    // The room changes with the window, which resizes the scroll viewport, not this element.
    const viewport = el.closest('[data-slot="scroll-area-viewport"]')
    if (viewport) observer.observe(viewport)
    return () => observer.disconnect()
  }, [scroll])
  const [width, setWidth] = useState(defaultWidth)
  const [isDragging, setIsDragging] = useState(false)
  // Read in an effect, not in the initial state: localStorage is unavailable
  // during SSR, and seeding state from it would hydrate against a different tree.
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(`${STORAGE_PREFIX}:${id}`))
    if (Number.isFinite(stored) && stored > 0) {
      setWidth(Math.min(maxWidth, Math.max(minWidth, stored)))
    }
  }, [id, minWidth, maxWidth])

  // The drag reads the width at mousedown; keeping it in a ref means the move
  // handler never has to be re-bound as the width changes.
  const widthRef = useRef(width)
  widthRef.current = width

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsDragging(true)

      const startX = e.clientX
      const startWidth = widthRef.current
      // The drag stops where the list would fall below its floor, so the stored
      // width is one this window can actually show. The CSS `min()` below covers
      // the other direction: a window that shrinks AFTER the width was stored.
      const containerWidth = containerRef.current?.clientWidth ?? Number.POSITIVE_INFINITY
      const cap = Math.max(minWidth, Math.min(maxWidth, containerWidth - MIN_LIST_WIDTH))
      const previousCursor = document.body.style.cursor
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'

      const handleMouseMove = (moveEvent: MouseEvent) => {
        // The pane is on the RIGHT, so dragging left widens it.
        const next = startWidth + (startX - moveEvent.clientX)
        setWidth(Math.min(cap, Math.max(minWidth, next)))
      }

      const handleMouseUp = () => {
        setIsDragging(false)
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = ''
        window.localStorage.setItem(`${STORAGE_PREFIX}:${id}`, String(widthRef.current))
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [id, minWidth, maxWidth]
  )

  const handleReset = useCallback(() => {
    setWidth(defaultWidth)
    window.localStorage.removeItem(`${STORAGE_PREFIX}:${id}`)
  }, [id, defaultWidth])

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          'relative grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_var(--detail-pane-col)]',
          className
        )}
        style={
          {
            '--detail-pane-w': `${width}px`,
            // The column the pane actually gets: the user's width, capped so the
            // list keeps its floor. `100%` resolves against this grid for both
            // the track and the divider's `right`, so the two always agree.
            '--detail-pane-col': `min(var(--detail-pane-w), calc(100% - ${MIN_LIST_WIDTH}px))`,
          } as React.CSSProperties
        }>
        <div className={cn('min-w-0', scroll === 'columns' && 'overflow-y-auto')}>{children}</div>

        {/* The divider doubles as the resize handle: a transparent strip straddling
            the border, so the hit area is comfortable while the line stays 1px.

            It hangs off the GRID, not off the pane column - in `scroll='columns'`
            that column is an `overflow-y-auto` box, which would clip a child
            sitting on its outer edge. */}
        <div
          onMouseDown={handleDragStart}
          onDoubleClick={handleReset}
          style={{ right: 'var(--detail-pane-col)' }}
          className='absolute inset-y-0 z-20 hidden w-2 translate-x-1/2 cursor-ew-resize lg:block'>
          <div
            className={cn(
              'mx-auto h-full w-px transition-colors',
              isDragging ? 'bg-info' : 'bg-transparent hover:bg-info/60'
            )}
          />
        </div>

        {/* The column stays STRETCHED and a wrapper inside it does the sticking.
            Making the column itself `self-start` would size it to the editor, and
            `border-l` would then stop dead at the editor's bottom edge instead of
            dividing the whole list. A stretched column also gives the sticky child
            room to travel, which an already-full-height element does not have. */}
        <div className={cn('hidden border-l lg:block', scroll === 'columns' && 'overflow-y-auto')}>
          {scroll === 'page' ? (
            /* `--settings-sticky-top` is published by `SettingsPage`, which owns the
               sticky title/tabs block above — pinning at a hardcoded `0` would slide
               this underneath it. `z-10` matches `FormSaveBar`, i.e. deliberately
               below that header.

               No height cap and no overflow: the pane is as tall as its content and
               the PAGE grows to hold it, so there is one scrollbar. Capping it at the
               viewport forced a second, overlaid scrollbar inside the pane and made
               the page scroll by the breadcrumb bar's height even when nothing
               overflowed. */
            <div
              ref={stickyRef}
              className={cn(paneFits && 'lg:sticky lg:z-10')}
              style={{ top: 'var(--settings-sticky-top, 0px)' }}>
              {pane}
            </div>
          ) : (
            pane
          )}
        </div>
      </div>

      {paneTitle && (
        <DockableDrawer
          open={!isDesktop && paneOpen}
          onOpenChange={(open) => {
            if (!open) onPaneClose?.()
          }}
          isDocked={false}
          width={380}
          onWidthChange={() => {}}
          minWidth={320}
          maxWidth={480}
          title={paneTitle}>
          {/* The pane has no header of its own - on desktop the list beside it is
              the context. In the drawer that context is gone, and on a phone the
              drawer covers the whole list, so this header is the only way out. */}
          <div className='flex min-h-0 flex-1 flex-col rounded-t-xl'>
            <DrawerHeader title={paneTitle} onClose={() => onPaneClose?.()} />
            <div className='min-h-0 flex-1 overflow-y-auto'>{pane}</div>
          </div>
        </DockableDrawer>
      )}
    </>
  )
}
