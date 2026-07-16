// packages/ui/src/components/event-calendar/event-popover/event-popover.tsx

'use client'

import { Maximize2, X } from 'lucide-react'
import * as React from 'react'
import { createPortal } from 'react-dom'
import { CommandBreadcrumb, CommandNavigation, useCommandNavigation } from '../../command'
import { PanelShell } from '../../panel-card'
import { Popover, PopoverAnchor, PopoverContent } from '../../popover'
import { ScrollArea } from '../../scroll-area'
import { SeriesScopeProvider } from './series-scope-chooser'
import type { EventDrillItem, EventSeriesConfig } from './types'

interface EventPopoverHeaderConfig {
  /** Context label shown left of the header row (e.g. a source/page name). */
  label?: string
  onExpand?: () => void
  onClose?: () => void
}

interface EventPopoverBodyProps {
  series?: EventSeriesConfig
  header?: EventPopoverHeaderConfig
  children: React.ReactNode
  className?: string
  /** Stretch to fill a height-bounded flex-column parent (e.g. `DockPanel`) instead of
   * sizing to content under the floating popover's `max-h-[min(85vh,40rem)]` cap. */
  fill?: boolean
}

interface EventPopoverBodyChromeProps {
  header?: EventPopoverHeaderConfig
  className?: string
  fill?: boolean
  children: React.ReactNode
}

const DrillOutletContext = React.createContext<HTMLElement | null>(null)

/**
 * Portals a drill page's content into the chrome's outlet while its frame is on top of the nav
 * stack. Rendered by the OWNING section (inside the consumer's subtree, which stays mounted while
 * drilled) so the page re-renders with live props/state — a frame-captured `render()` closure
 * would go stale the moment the consumer's state changes, because the chrome that invokes it
 * never re-renders on consumer updates (the board popover's recurrence editor was the concrete
 * casualty). Returns `null` at root or when another frame is on top.
 */
export function EventDrillPage({ id, children }: { id: string; children: React.ReactNode }) {
  const { current } = useCommandNavigation<EventDrillItem>()
  const outlet = React.useContext(DrillOutletContext)
  if (current?.id !== id || !outlet) return null
  return createPortal(children, outlet)
}

/**
 * Renders the root header row when at the top of the nav stack, or a `CommandBreadcrumb` once a
 * section has drilled in — then the scrollable `PanelShell` body. Escape pops one level instead
 * of bubbling up to close the popover; at root it's left alone so Radix's own Escape-to-close
 * still applies.
 *
 * The root `children` stay mounted (hidden via the `hidden` attribute, not unmounted) even while
 * drilled: `children` is often a single consumer component (e.g. the board's
 * `VisitPopoverContent`) that owns section-scoped state — a recurrence editor's in-progress
 * pattern, a confirm dialog, etc. Swapping it out for `current.render()` the way a naive
 * `isAtRoot ? children : current.render()` ternary would tear that state down (and any state
 * setters captured by an already-pushed drill frame's `render()` closure would become no-ops on
 * the unmounted fiber) the instant any section drills in, then reset it again on the way back.
 * Tailwind's `space-y-*` selectors already exclude `[hidden]` elements, so this doesn't add a
 * phantom gap above the drilled page.
 */
function EventPopoverBodyChrome({
  header,
  className,
  fill,
  children,
}: EventPopoverBodyChromeProps) {
  const { current, isAtRoot, pop } = useCommandNavigation<EventDrillItem>()
  const [drillOutlet, setDrillOutlet] = React.useState<HTMLElement | null>(null)

  return (
    <div
      className={fill ? 'flex min-h-0 flex-1 flex-col' : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !isAtRoot) {
          e.preventDefault()
          e.stopPropagation()
          pop()
        }
      }}>
      {isAtRoot ? (
        header && (
          <div className='flex items-center gap-2 px-4 pt-3 pb-1'>
            {header.label && (
              <span className='truncate text-muted-foreground text-xs font-medium'>
                {header.label}
              </span>
            )}
            <div className='ml-auto flex shrink-0 items-center gap-1'>
              {header.onExpand && (
                <button
                  type='button'
                  onClick={header.onExpand}
                  aria-label='Expand'
                  className='rounded-lg p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground'>
                  <Maximize2 className='size-3.5' />
                </button>
              )}
              {header.onClose && (
                <button
                  type='button'
                  onClick={header.onClose}
                  aria-label='Close'
                  className='rounded-lg p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground'>
                  <X className='size-3.5' />
                </button>
              )}
            </div>
          </div>
        )
      ) : (
        <CommandBreadcrumb rootLabel={header?.label ?? 'Back'} />
      )}
      <ScrollArea
        className={fill ? 'min-h-0 flex-1' : undefined}
        viewportClassName={fill ? 'h-full' : 'max-h-[min(85vh,40rem)]'}>
        <PanelShell className={className}>
          <DrillOutletContext.Provider value={drillOutlet}>
            <div hidden={!isAtRoot}>{children}</div>
            {/* Drill pages portal in here (`EventDrillPage`) so they render from the consumer's
                live subtree; `render` on the frame stays supported for static pages. */}
            {!isAtRoot && <div ref={setDrillOutlet} className='space-y-2' />}
            {!isAtRoot && current?.render?.()}
          </DrillOutletContext.Provider>
        </PanelShell>
      </ScrollArea>
    </div>
  )
}

/**
 * Body-only export for consumers that already own a popover/trigger (e.g. a composition that
 * mounts its own `PopoverContent`) — renders the header row, series-scope chooser, and the
 * scrollable `PanelShell` without the `Popover`/`PopoverAnchor` shell itself. Mounts a
 * `CommandNavigation` stack so sections drill in place (date/time/repeat/people pickers) instead
 * of nesting their own popovers.
 */
export function EventPopoverBody({
  series,
  header,
  children,
  className,
  fill,
}: EventPopoverBodyProps) {
  return (
    <SeriesScopeProvider series={series}>
      <CommandNavigation<EventDrillItem>>
        <EventPopoverBodyChrome header={header} className={className} fill={fill}>
          {children}
        </EventPopoverBodyChrome>
      </CommandNavigation>
    </SeriesScopeProvider>
  )
}

interface EventPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The chip/element the popover anchors to — wrapped in `PopoverAnchor asChild`. */
  anchor: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  series?: EventSeriesConfig
  header?: EventPopoverHeaderConfig
  children: React.ReactNode
}

/**
 * Base positioning + chrome for event popovers (Notion-Calendar-style). Owns the
 * `Popover`/`PopoverAnchor`/`PopoverContent` shell exactly the way the dispatch board's
 * calendar grid does today, so grid/consumer code stops owning any popover markup —
 * consumers wire data + mutations and pass `EventPopover*Section`s as `children`.
 */
export function EventPopover({
  open,
  onOpenChange,
  anchor,
  side = 'right',
  align = 'start',
  series,
  header,
  children,
}: EventPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{anchor}</PopoverAnchor>
      <PopoverContent
        side={side}
        align={align}
        updatePositionStrategy='always'
        onOpenAutoFocus={(e) => e.preventDefault()}
        className='w-80 rounded-3xl p-0 shadow-xl'>
        <EventPopoverBody series={series} header={header}>
          {children}
        </EventPopoverBody>
      </PopoverContent>
    </Popover>
  )
}
