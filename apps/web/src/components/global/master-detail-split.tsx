// apps/web/src/components/global/master-detail-split.tsx
'use client'

import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { cn } from '@auxx/ui/lib/utils'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMedia } from '~/hooks/use-media'

const STORAGE_PREFIX = 'master-detail-width'

/** Below this the split collapses to one column and the detail moves into a drawer. */
const DESKTOP_QUERY = '(min-width: 1024px)'

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
      const previousCursor = document.body.style.cursor
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'

      const handleMouseMove = (moveEvent: MouseEvent) => {
        // The pane is on the RIGHT, so dragging left widens it.
        const next = startWidth + (startX - moveEvent.clientX)
        setWidth(Math.min(maxWidth, Math.max(minWidth, next)))
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
        className={cn(
          'relative grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_var(--detail-pane-w,420px)]',
          className
        )}
        style={{ '--detail-pane-w': `${width}px` } as React.CSSProperties}>
        <div className={cn('min-w-0', scroll === 'columns' && 'overflow-y-auto')}>{children}</div>

        {/* The divider doubles as the resize handle: a transparent strip straddling
            the border, so the hit area is comfortable while the line stays 1px.

            It hangs off the GRID, not off the pane column - in `scroll='columns'`
            that column is an `overflow-y-auto` box, which would clip a child
            sitting on its outer edge. */}
        <div
          onMouseDown={handleDragStart}
          onDoubleClick={handleReset}
          style={{ right: 'var(--detail-pane-w)' }}
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
               below that header. */
            <div
              className='lg:sticky lg:z-10 lg:overflow-hidden'
              style={{
                top: 'var(--settings-sticky-top, 0px)',
                maxHeight:
                  'calc(var(--settings-viewport-h, 100vh) - var(--settings-sticky-top, 0px))',
              }}>
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
          {pane}
        </DockableDrawer>
      )}
    </>
  )
}
