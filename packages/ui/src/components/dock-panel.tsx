// packages/ui/src/components/dock-panel.tsx
'use client'

import { Sheet, SheetContent, SheetTitle } from '@auxx/ui/components/sheet'
import { useIsMobile } from '@auxx/ui/hooks/use-mobile'
import { cn } from '@auxx/ui/lib/utils'
import * as React from 'react'

/** Which edge of the parent flex row the panel docks to. */
type DockSide = 'left' | 'right'

interface DockChrome {
  side: DockSide
  onClose?: () => void
  onPopOut?: () => void
  onFlipSide?: (side: DockSide) => void
}

const DockChromeContext = React.createContext<DockChrome | null>(null)

/**
 * The enclosing dock's chrome controls (flip-side / pop-out / close), or `null` when the content
 * isn't docked. Consumed by a content-provided header (e.g. `EventTitleSection`) so it can fold
 * the controls into its own actions row — the dock renders no separate header of its own. Only
 * present in the desktop docked column; the mobile sheet uses its own built-in close button.
 */
export function useDockChrome(): DockChrome | null {
  return React.useContext(DockChromeContext)
}

interface DockPanelProps {
  /** Whether the panel is open. Closed takes no layout space. */
  open: boolean
  /** Which side the panel docks to. Render `DockPanel` where a LEFT dock should sit in the
   * flex row (e.g. between a module sidebar and the grid) — `side='left'` keeps that DOM
   * position, `side='right'` jumps after the other siblings via CSS `order`. */
  side: DockSide
  /** Fixed width while open. Not resizable in v1. */
  width?: string
  /** Close the dock. Surfaced to the content via `useDockChrome()`. */
  onClose: () => void
  /** Undock -> float. Omit to hide the pop-out control. Surfaced via `useDockChrome()`. */
  onPopOut?: () => void
  /** Flip side (left <-> right). Omit to hide the flip-side control. Surfaced via `useDockChrome()`. */
  onFlipSide?: (side: DockSide) => void
  /** Key that changes per selected entity — drives the cross-fade content swap. */
  contentKey: string
  children: React.ReactNode
}

const DEFAULT_WIDTH = '20rem'

/**
 * Notion-Calendar-style dock shell: a flex column that pushes its siblings on desktop, or a
 * bottom sheet on narrow viewports. Content-agnostic — it only owns placement, the width
 * handoff, chrome (flip-side / pop-out / close), and the `DockPanelFrame` content cross-fade.
 * See `plans/dispatch/21-dockable-event-panel.md` for the full design.
 */
function DockPanel({
  open,
  side,
  width = DEFAULT_WIDTH,
  onClose,
  onPopOut,
  onFlipSide,
  contentKey,
  children,
}: DockPanelProps) {
  const isMobile = useIsMobile()
  // Keep the desktop frame mounted for its compositor-only exit animation. The outer column
  // reserves/releases its final width once per transition; only this fixed-width inner frame moves.
  const [rendered, setRendered] = React.useState(open)
  if (open && !rendered) setRendered(true)

  React.useEffect(() => {
    if (open || !rendered) return
    // Animation events can be suppressed by the browser or test environment. This fallback keeps
    // the closed panel from remaining mounted/inert indefinitely.
    const timeout = window.setTimeout(() => setRendered(false), 320)
    return () => window.clearTimeout(timeout)
  }, [open, rendered])

  if (isMobile) {
    return (
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}>
        <SheetContent side='bottom' className='flex h-[70vh] flex-col gap-0 p-0'>
          {/* The content provides its own visible header (e.g. `EventTitleSection`); this keeps
           * the dialog accessible without a duplicate title row. Flip-side / pop-out are
           * meaningless in a sheet, and the sheet's built-in close button covers dismissal — so
           * no `DockChrome` is provided on mobile. */}
          <SheetTitle className='sr-only'>Panel</SheetTitle>
          <div className='min-h-0 flex-1 overflow-y-auto'>{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      className={cn(
        'flex h-full shrink-0 flex-col overflow-hidden',
        side === 'right' && 'order-[999]'
      )}
      style={{ width: rendered ? width : '0px' }}
      aria-hidden={!open}
      inert={!open}>
      {/* Reserve the final width in one layout pass, then animate only this fixed-width frame's
       * transform. Unlike the old width tween, this never remeasures the calendar per frame. */}
      {rendered && (
        <div
          className={cn(
            'auxx-dock-panel-frame flex h-full flex-col',
            side === 'left' ? 'border-r' : 'border-l'
          )}
          style={{ width }}
          data-side={side}
          data-state={open ? 'open' : 'closed'}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && !open) setRendered(false)
          }}>
          {/* No header of our own — the content renders one and folds these controls into it
           * via `useDockChrome()`, so the dock chrome and the event title never duplicate. */}
          <DockChromeContext.Provider value={{ side, onClose, onPopOut, onFlipSide }}>
            <DockPanelFrame contentKey={contentKey}>{children}</DockPanelFrame>
          </DockChromeContext.Provider>
        </div>
      )}
    </div>
  )
}

interface DockPanelFrameProps {
  contentKey: string
  children: React.ReactNode
}

interface ExitingLayer {
  key: string
  children: React.ReactNode
}

/**
 * Content-swap layer for `DockPanel`'s body — a React port of `packages/chat`'s
 * `FrameTransition` (Preact; see `chat/src/components/frame-transition.tsx`, not imported
 * since chat is a separate bundle). On `contentKey` change, the previous render is frozen as
 * an absolutely-positioned "exiting" layer while the new render slides in from the right —
 * the panel shell (header + controls) never remounts, so scroll position and focus survive.
 *
 * The key change is detected *during render* (not in an effect) so both layers commit in the
 * same paint — otherwise there'd be a one-frame flash where the new content appears without
 * its slide-in animation.
 */
function DockPanelFrame({ contentKey, children }: DockPanelFrameProps) {
  const lastKeyRef = React.useRef(contentKey)
  const lastChildrenRef = React.useRef(children)
  const [exiting, setExiting] = React.useState<ExitingLayer | null>(null)

  if (lastKeyRef.current !== contentKey && (!exiting || exiting.key !== lastKeyRef.current)) {
    setExiting({ key: lastKeyRef.current, children: lastChildrenRef.current })
  }

  React.useLayoutEffect(() => {
    lastKeyRef.current = contentKey
    lastChildrenRef.current = children
  })

  const handleExitEnd = (event: React.AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    setExiting(null)
  }

  return (
    <div
      className={cn(
        'auxx-dock-frame-transition',
        exiting && 'auxx-dock-frame-transition--animating'
      )}>
      {exiting && (
        <div
          key={exiting.key}
          className='auxx-dock-frame-layer auxx-dock-frame--exiting'
          onAnimationEnd={handleExitEnd}>
          {exiting.children}
        </div>
      )}
      <div
        key={contentKey}
        className={cn('auxx-dock-frame-layer', exiting && 'auxx-dock-frame--entering')}>
        {children}
      </div>
    </div>
  )
}

export { DockPanel, DockPanelFrame }
export type { DockPanelProps, DockSide }
