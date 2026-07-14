// packages/ui/src/components/dock-panel.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Sheet, SheetContent, SheetTitle } from '@auxx/ui/components/sheet'
import { useIsMobile } from '@auxx/ui/hooks/use-mobile'
import { cn } from '@auxx/ui/lib/utils'
import { ArrowLeftRight, PanelRightOpen, X } from 'lucide-react'
import * as React from 'react'

/** Which edge of the parent flex row the panel docks to. */
type DockSide = 'left' | 'right'

interface DockPanelProps {
  /** Whether the panel is open. Closed animates width 0 <-> `width` and takes no layout
   * space once the tween finishes. */
  open: boolean
  /** Which side the panel docks to. Render `DockPanel` where a LEFT dock should sit in the
   * flex row (e.g. between a module sidebar and the grid) — `side='left'` keeps that DOM
   * position, `side='right'` jumps after the other siblings via CSS `order`. */
  side: DockSide
  /** Fixed width while open. Not resizable in v1. */
  width?: string
  /** X button in the header. */
  onClose: () => void
  /** Undock -> float. Omit to hide the pop-out button. */
  onPopOut?: () => void
  /** Flip side (left <-> right). Omit to hide the flip-side button. */
  onFlipSide?: (side: DockSide) => void
  /** Key that changes per selected entity — drives the slide/cross-fade content swap. */
  contentKey: string
  /** Title row content, to the left of the control cluster. */
  header?: React.ReactNode
  children: React.ReactNode
}

const DEFAULT_WIDTH = '20rem'

/**
 * Notion-Calendar-style dock shell: a flex column that pushes its siblings on desktop, or a
 * bottom sheet on narrow viewports. Content-agnostic — it only owns placement, the width
 * tween, chrome (flip-side / pop-out / close), and the `DockPanelFrame` content cross-fade.
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
  header,
  children,
}: DockPanelProps) {
  const isMobile = useIsMobile()

  // Keep children mounted through the 280ms close tween, then unmount — otherwise the
  // collapsed column keeps its full content alive at width 0: still in the a11y tree, still
  // tab-focusable, and (for data-heavy consumers) still running queries in duplicate next to
  // the floating popover. `inert` covers the closing window itself.
  const [rendered, setRendered] = React.useState(open)
  if (open && !rendered) setRendered(true)

  if (isMobile) {
    return (
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}>
        <SheetContent side='bottom' className='flex h-[70vh] flex-col gap-0 p-0'>
          <SheetTitle className='sr-only'>Panel</SheetTitle>
          {/* Flip-side / pop-out are meaningless in a sheet — omit both handlers so
           * `DockPanelHeader` only renders the title row. The sheet's own built-in close
           * button (top-right, from `SheetContent`) covers dismissal. */}
          <DockPanelHeader header={header} side={side} />
          <div className='min-h-0 flex-1 overflow-y-auto'>{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      className={cn(
        'flex h-full shrink-0 flex-col overflow-hidden',
        'transition-[width] duration-[280ms] ease-[var(--auxx-dock-ease)]',
        side === 'right' && 'order-[999]'
      )}
      style={{ width: open ? width : '0px' }}
      aria-hidden={!open}
      inert={!open}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === 'width' && !open) {
          setRendered(false)
        }
      }}>
      {/* Fixed-width inner wrapper so text doesn't reflow mid-tween, and so the border
       * (grid-facing edge) is clipped away entirely by the outer `overflow-hidden` once
       * collapsed to 0 width — the column then truly takes no space at rest. */}
      {rendered && (
        <div
          className={cn('flex h-full flex-col', side === 'left' ? 'border-r' : 'border-l')}
          style={{ width }}>
          <DockPanelHeader
            header={header}
            side={side}
            onFlipSide={onFlipSide}
            onPopOut={onPopOut}
            onClose={onClose}
          />
          <DockPanelFrame contentKey={contentKey}>{children}</DockPanelFrame>
        </div>
      )}
    </div>
  )
}

interface DockPanelHeaderProps {
  header?: React.ReactNode
  side: DockSide
  onFlipSide?: (side: DockSide) => void
  onPopOut?: () => void
  onClose?: () => void
}

/** Header row: `header` content on the left, control cluster on the right. Each control
 * only renders when its handler is provided. */
function DockPanelHeader({ header, side, onFlipSide, onPopOut, onClose }: DockPanelHeaderProps) {
  return (
    <div className='flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2'>
      <div className='flex min-w-0 flex-1 items-center gap-2'>{header}</div>
      <div className='flex shrink-0 items-center gap-0.5'>
        {onFlipSide && (
          <Button
            variant='ghost'
            size='icon'
            aria-label='Flip side'
            onClick={() => onFlipSide(side === 'left' ? 'right' : 'left')}>
            <ArrowLeftRight />
          </Button>
        )}
        {onPopOut && (
          <Button variant='ghost' size='icon' aria-label='Pop out' onClick={onPopOut}>
            <PanelRightOpen />
          </Button>
        )}
        {onClose && (
          <Button variant='ghost' size='icon' aria-label='Close' onClick={onClose}>
            <X />
          </Button>
        )}
      </div>
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
