'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Separator } from '@auxx/ui/components/separator'
import { Sheet, SheetContent } from '@auxx/ui/components/sheet'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { SimpleTooltip, type TooltipContent, TooltipProvider } from '@auxx/ui/components/tooltip'
import { useIsMobile } from '@auxx/ui/hooks/use-mobile'
import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { PanelLeft } from 'lucide-react'
import { motion } from 'motion/react'
import { Slot as SlotPrimitive } from 'radix-ui'
import * as React from 'react'

const SIDEBAR_COOKIE_NAME = 'sidebar_state'
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH = '16rem'
const SIDEBAR_WIDTH_MOBILE = '18rem'
const SIDEBAR_MIN_WIDTH = 200
const SIDEBAR_MAX_WIDTH = 400
const SIDEBAR_DEFAULT_WIDTH = 256
/** Distance from the screen edge (px) the cursor must reach for a resize drag to snap collapsed. */
const SIDEBAR_COLLAPSE_EDGE = 24
/** Hover-intent delay (ms) before the collapsed sidebar peeks in — kept short so it feels snappy. */
const SIDEBAR_PEEK_OPEN_DELAY = 20
const SIDEBAR_KEYBOARD_SHORTCUT = '.'

type SidebarContext = {
  state: 'expanded' | 'collapsed'
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
  /** Whether this provider owns a drag-resizable width (opt-in). */
  resizable: boolean
  /** Current sidebar width in px (only meaningful when `resizable`). */
  width: number
  /** Set the live width during a drag — does NOT persist the cookie (see `persistWidth`). */
  setWidth: (width: number) => void
  /** Persist the given width to the `${persistKey}_width` cookie (call on drag end). */
  persistWidth: (width: number) => void
  minWidth: number
  maxWidth: number
  defaultWidth: number
  /** True while a resize drag is in progress — containers drop their width transition. */
  isResizing: boolean
  setIsResizing: (resizing: boolean) => void
  /** Whether the collapsed sidebar is floating in as a hover/drag peek overlay. */
  peek: boolean
  setPeek: (peek: boolean) => void
  /** When set, the peek overlay is pinned open (used by DnD spring-loading). */
  holdPeek: boolean
  setHoldPeek: (hold: boolean) => void
  /** Open the peek overlay after a short hover-intent delay. */
  requestPeekOpen: () => void
  /** Cancel a pending peek-open (mouse left the hot zone before it fired). */
  cancelPeekOpen: () => void
  /** Close the peek overlay after a short delay (no-op while `holdPeek`). */
  requestPeekClose: () => void
  /** Cancel a pending peek-close (mouse re-entered the overlay). */
  cancelPeekClose: () => void
}

const SidebarContext = React.createContext<SidebarContext | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider.')
  }

  return context
}

/** True on pointers that can hover (mouse/trackpad) — gates the peek hot zone off touch. */
function useHoverCapable() {
  const [hoverable, setHoverable] = React.useState(false)
  React.useEffect(() => {
    const mq = window.matchMedia('(hover: hover)')
    setHoverable(mq.matches)
    const onChange = () => setHoverable(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return hoverable
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  width,
  resizable = false,
  minWidth = SIDEBAR_MIN_WIDTH,
  maxWidth = SIDEBAR_MAX_WIDTH,
  defaultWidth = SIDEBAR_DEFAULT_WIDTH,
  persistKey = SIDEBAR_COOKIE_NAME,
  keyboardShortcut = SIDEBAR_KEYBOARD_SHORTCUT,
  nested = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Static CSS width (e.g. `'16rem'`) for non-resizable sidebars. Ignored when `resizable`. */
  width?: string
  /**
   * Opt into drag-to-resize. When true, `--sidebar-width` is driven by `width` state (px),
   * a `SidebarResizeHandle` + hover-peek overlay render inside the fixed `Sidebar`, and the
   * width is persisted to a `${persistKey}_width` cookie. Defaults to `false` (static width).
   */
  resizable?: boolean
  /** Min drag width in px (default 200). */
  minWidth?: number
  /** Max drag width in px (default 400). */
  maxWidth?: number
  /** Initial/reset width in px (default 256) — pass from the `${persistKey}_width` cookie for SSR. */
  defaultWidth?: number
  /**
   * Cookie name used to persist the open state on every `setOpen` call. Pass `false` to skip
   * the cookie write entirely (e.g. a nested module sidebar that persists state elsewhere).
   * Defaults to `'sidebar_state'` — the historical single cookie name, so existing consumers
   * see zero behavior change.
   */
  persistKey?: string | false
  /**
   * Key that toggles the sidebar when held with Cmd/Ctrl. Pass `false` to skip registering
   * the `window` keydown listener (e.g. a nested module sidebar shouldn't fight the app-shell
   * sidebar for the same shortcut). Defaults to `'.'`.
   */
  keyboardShortcut?: string | false
  /**
   * Renders the wrapper as a `flex h-full min-h-0` participant instead of the full-height
   * (`min-h-svh`) page shell, so it can be nested inside a flex row under a toolbar (e.g. a
   * module sidebar nested under the app-shell `SidebarProvider`). CSS vars and `TooltipProvider`
   * are unaffected.
   */
  nested?: boolean
}) {
  // const isMobile = false
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === 'function' ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

      // This sets the cookie to keep the sidebar state.
      if (persistKey) {
        document.cookie = `${persistKey}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
      }
    },
    [setOpenProp, open, persistKey]
  )

  // Live drag width (px). Independent of open/closed — collapsing never resets it.
  const [width_, setWidth] = React.useState(defaultWidth)
  const [isResizing, setIsResizing] = React.useState(false)
  const persistWidth = React.useCallback(
    (w: number) => {
      if (persistKey) {
        document.cookie = `${persistKey}_width=${Math.round(w)}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
      }
    },
    [persistKey]
  )

  // Hover/drag peek overlay (collapsed state, fixed variant only).
  const [peek, setPeek] = React.useState(false)
  const [holdPeek, setHoldPeek] = React.useState(false)
  const holdPeekRef = React.useRef(holdPeek)
  holdPeekRef.current = holdPeek
  const peekOpenTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const peekCloseTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelPeekOpen = React.useCallback(() => {
    if (peekOpenTimer.current) clearTimeout(peekOpenTimer.current)
    peekOpenTimer.current = null
  }, [])
  const cancelPeekClose = React.useCallback(() => {
    if (peekCloseTimer.current) clearTimeout(peekCloseTimer.current)
    peekCloseTimer.current = null
  }, [])
  const requestPeekOpen = React.useCallback(() => {
    cancelPeekClose()
    if (peekOpenTimer.current) return
    peekOpenTimer.current = setTimeout(() => {
      peekOpenTimer.current = null
      setPeek(true)
    }, SIDEBAR_PEEK_OPEN_DELAY)
  }, [cancelPeekClose])
  const requestPeekClose = React.useCallback(() => {
    cancelPeekOpen()
    if (holdPeekRef.current) return
    if (peekCloseTimer.current) return
    peekCloseTimer.current = setTimeout(() => {
      peekCloseTimer.current = null
      setPeek(false)
    }, 150)
  }, [cancelPeekOpen])

  // Expanding always clears any peek overlay + pin.
  React.useEffect(() => {
    if (open) {
      cancelPeekOpen()
      cancelPeekClose()
      setPeek(false)
      setHoldPeek(false)
    }
  }, [open, cancelPeekOpen, cancelPeekClose])

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open)
  }, [isMobile, setOpen])

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    if (!keyboardShortcut) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === keyboardShortcut && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleSidebar, keyboardShortcut])

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? 'expanded' : 'collapsed'

  const contextValue = React.useMemo<SidebarContext>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
      resizable,
      width: width_,
      setWidth,
      persistWidth,
      minWidth,
      maxWidth,
      defaultWidth,
      isResizing,
      setIsResizing,
      peek,
      setPeek,
      holdPeek,
      setHoldPeek,
      requestPeekOpen,
      cancelPeekOpen,
      requestPeekClose,
      cancelPeekClose,
    }),
    [
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      toggleSidebar,
      resizable,
      width_,
      persistWidth,
      minWidth,
      maxWidth,
      defaultWidth,
      isResizing,
      peek,
      holdPeek,
      requestPeekOpen,
      cancelPeekOpen,
      requestPeekClose,
      cancelPeekClose,
    ]
  )

  // `--sidebar-width`: driven by drag state when resizable, otherwise the static string prop.
  const sidebarWidth = resizable ? `${width_}px` : width || SIDEBAR_WIDTH

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        <div
          style={
            {
              '--sidebar-width': sidebarWidth,
              ...style,
            } as React.CSSProperties
          }
          className={cn(
            'group/sidebar-wrapper flex has-data-[variant=inset]:bg-sidebar',
            nested ? 'h-full min-h-0' : 'min-h-svh',
            className
          )}
          {...props}>
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  side = 'left',
  variant = 'sidebar',
  collapsible = 'offcanvas',
  fixed = true, // Default to true for backward compatibility
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  side?: 'left' | 'right'
  variant?: 'sidebar' | 'floating' | 'inset'
  collapsible?: 'offcanvas' | 'none'
  fixed?: boolean // New prop for non-fixed sidebar
}) {
  const {
    isMobile,
    state,
    openMobile,
    setOpenMobile,
    resizable,
    isResizing,
    peek,
    cancelPeekClose,
    cancelPeekOpen,
    requestPeekClose,
  } = useSidebar()

  // Simple sidebar, no collapsible behavior
  if (collapsible === 'none') {
    return (
      <div
        className={cn(
          'flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground select-none',
          className
        )}
        {...props}>
        {children}
      </div>
    )
  }

  // Mobile sidebar (always rendered as a drawer)
  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          data-sidebar='sidebar'
          data-mobile='true'
          className='w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden'
          style={{ '--sidebar-width': SIDEBAR_WIDTH_MOBILE } as React.CSSProperties}
          side={side}>
          <div className='flex h-full w-full flex-col select-none pt-safe pb-safe'>{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  // Desktop sidebar (fixed or non-fixed)
  if (fixed) {
    // Original fixed sidebar implementation
    return (
      <div
        className='group peer hidden text-sidebar-foreground md:block '
        data-state={state}
        data-collapsible={state === 'collapsed' ? collapsible : ''}
        data-variant={variant}
        data-side={side}
        data-resizing={isResizing ? '' : undefined}
        data-peek={peek ? '' : undefined}>
        {/* This is what handles the sidebar gap on desktop */}
        <div
          className={cn(
            'relative h-svh w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear ',
            'group-data-[collapsible=offcanvas]:w-0',
            'group-data-[side=right]:rotate-180',
            'group-data-[resizing]:transition-none'
          )}
        />
        <div
          className={cn(
            // z-30 keeps the panel above page content + its sticky `z-10` headers at all times —
            // notably while animating open from a peek, when content briefly overlaps the panel.
            'fixed inset-y-0 z-30 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-200 ease-linear md:flex ',
            side === 'left'
              ? 'left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)] group-data-[peek]:left-0!'
              : 'right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)] group-data-[peek]:right-0!',
            // Adjust the padding for floating and inset variants.
            variant === 'floating' || variant === 'inset'
              ? 'p-2'
              : 'group-data-[side=left]:border-r group-data-[side=right]:border-l ', //dark:border-neutral-900/70 border-neutral-950/20
            // Peek overlay: float above content + sticky headers (below dialogs); slide in fast.
            'group-data-[peek]:z-40 group-data-[peek]:shadow-xl group-data-[peek]:duration-100',
            'group-data-[resizing]:transition-none',
            className
          )}
          onMouseEnter={
            resizable
              ? () => {
                  cancelPeekClose()
                  cancelPeekOpen()
                }
              : undefined
          }
          // Don't auto-close the peek while a resize drag is in flight — the pointer leaves the
          // panel bounds as the width follows it, but the user is still adjusting the width.
          onMouseLeave={
            resizable
              ? () => {
                  if (!isResizing) requestPeekClose()
                }
              : undefined
          }
          {...props}>
          <div className='absolute right-0 inset-y-0 border-x border-r-white/60 dark:border-r-white/5 border-l-black/10 dark:border-l-black/50 '></div>
          <div
            data-sidebar='sidebar'
            className='flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow-sm select-none'>
            {children}
          </div>
          {/* Handle is live while expanded OR peeking, so the width can be adjusted in either
              state. Skipped when fully collapsed (off-canvas) — there it would sit at the screen
              edge on top of the peek hot zone. */}
          {resizable && (peek || state === 'expanded') && <SidebarResizeHandle side={side} />}
        </div>
        {resizable && <SidebarPeekHotZone side={side} />}
      </div>
    )
  } else {
    // Non-fixed sidebar implementation — a normal flex sibling (e.g. a module sidebar nested
    // under a toolbar). Collapses to width 0 (own `data-collapsible` attribute, not a `group`
    // ancestor's — this element carries both) instead of the fixed variant's off-screen slide.
    return (
      <div
        className={cn(
          'hidden shrink-0 overflow-hidden text-sidebar-foreground transition-[width] duration-200 ease-linear md:block',
          'w-(--sidebar-width) data-[collapsible=offcanvas]:w-0',
          side === 'left' ? 'border-r' : 'border-l',
          className
        )}
        data-state={state}
        data-collapsible={state === 'collapsed' ? collapsible : ''}
        data-variant={variant}
        data-side={side}
        {...props}>
        <div
          data-sidebar='sidebar'
          className={cn(
            'flex h-full w-(--sidebar-width) flex-col bg-sidebar select-none',
            variant === 'floating' && 'rounded-lg border border-sidebar-border shadow-sm',
            variant === 'inset' && 'rounded-lg border border-sidebar-border'
          )}>
          {children}
        </div>
      </div>
    )
  }
}

function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<typeof Button>) {
  const { toggleSidebar, state } = useSidebar()

  return (
    <SimpleTooltip
      content={state === 'expanded' ? 'Collapse sidebar' : 'Expand sidebar'}
      shortcut={['⌘', '.']}>
      <Button
        data-sidebar='trigger'
        variant='ghost'
        size='icon'
        className={cn(
          'h-7 w-7',
          state === 'expanded' ? 'cursor-w-resize' : 'cursor-e-resize',
          className
        )}
        onClick={(event) => {
          onClick?.(event)
          toggleSidebar()
        }}
        {...props}>
        <PanelLeft />
        <span className='sr-only'>Toggle Sidebar</span>
      </Button>
    </SimpleTooltip>
  )
}

/**
 * Attio-style drag-to-resize strip straddling the fixed sidebar's inner edge. Rendered
 * automatically inside a `resizable` `Sidebar` — consumers don't mount it. Live-updates the
 * provider `width` (clamped to `[minWidth, maxWidth]`), snaps to collapsed when dragged well
 * below `minWidth`, persists the width on release, and resets to `defaultWidth` on double-click.
 */
function SidebarResizeHandle({ side }: { side: 'left' | 'right' }) {
  const {
    width,
    setWidth,
    persistWidth,
    minWidth,
    maxWidth,
    defaultWidth,
    setIsResizing,
    setOpen,
  } = useSidebar()

  // Latest committed width, read at drag end for persistence (state is async).
  const widthRef = React.useRef(width)
  widthRef.current = width

  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsResizing(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const startX = e.clientX
      const startWidth = widthRef.current
      let collapsed = false

      const cleanup = () => {
        setIsResizing(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      const handleMouseMove = (moveEvent: MouseEvent) => {
        // Snap to collapsed only once the cursor is dragged right up to the screen edge — not
        // merely when the width bottoms out at the minimum (Attio behavior).
        const atEdge =
          side === 'left'
            ? moveEvent.clientX <= SIDEBAR_COLLAPSE_EDGE
            : moveEvent.clientX >= window.innerWidth - SIDEBAR_COLLAPSE_EDGE
        if (atEdge) {
          collapsed = true
          cleanup()
          setOpen(false)
          return
        }

        // Dragging toward the inner edge grows the sidebar (mirror for a right sidebar).
        const delta = side === 'left' ? moveEvent.clientX - startX : startX - moveEvent.clientX
        const clamped = Math.min(maxWidth, Math.max(minWidth, startWidth + delta))
        widthRef.current = clamped
        setWidth(clamped)
      }

      const handleMouseUp = () => {
        cleanup()
        // Width state keeps its last value when we snap to collapsed, so re-expanding restores it.
        if (!collapsed) persistWidth(widthRef.current)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [side, minWidth, maxWidth, setWidth, persistWidth, setIsResizing, setOpen]
  )

  const handleDoubleClick = React.useCallback(() => {
    widthRef.current = defaultWidth
    setWidth(defaultWidth)
    persistWidth(defaultWidth)
  }, [defaultWidth, setWidth, persistWidth])

  return (
    <div
      role='separator'
      aria-orientation='vertical'
      aria-label='Resize sidebar'
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      className={cn(
        'group/resize absolute inset-y-0 z-20 flex w-2 cursor-col-resize items-stretch justify-center',
        side === 'left' ? 'right-0 translate-x-1/2' : 'left-0 -translate-x-1/2'
      )}>
      {/* Accent line on the border, revealed on hover / while dragging. */}
      <div className='w-px bg-transparent transition-colors group-hover/resize:bg-info' />
    </div>
  )
}

/**
 * Left-edge hot zone that floats the collapsed sidebar in as a peek overlay on hover. Only
 * rendered on hover-capable pointers while the sidebar is collapsed and not already peeking.
 */
function SidebarPeekHotZone({ side }: { side: 'left' | 'right' }) {
  const { state, peek, requestPeekOpen, cancelPeekOpen } = useSidebar()
  const hoverable = useHoverCapable()

  if (!hoverable || state !== 'collapsed' || peek) return null

  return (
    <div
      aria-hidden
      onMouseEnter={requestPeekOpen}
      onMouseLeave={cancelPeekOpen}
      className={cn('fixed inset-y-0 z-40 w-3', side === 'left' ? 'left-0' : 'right-0')}
    />
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<'main'>) {
  return (
    <main
      className={cn(
        'relative flex min-h-svh flex-1 flex-col bg-background',
        'peer-data-[variant=inset]:min-h-[calc(100svh-(--spacing(4)))] md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm',
        className
      )}
      {...props}
    />
  )
}

function SidebarInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-sidebar='input'
      className={cn(
        'h-8 w-full bg-background shadow-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        className
      )}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-sidebar='header' className={cn('flex flex-col gap-2 p-2', className)} {...props} />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-sidebar='footer' className={cn('flex flex-col gap-2 p-2', className)} {...props} />
  )
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-sidebar='separator'
      className={cn('mx-2 w-auto bg-sidebar-border', className)}
      {...props}
    />
  )
}

/**
 * Scrollable content area for the sidebar with automatic scroll shadows.
 * Uses ScrollArea v2 with custom darker fade overlays and a thin scrollbar.
 */
function SidebarContent({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <ScrollArea
      className={cn('relative min-h-0 flex-1', className)}
      fadeClassName='before:bg-gradient-to-b before:from-black/10 before:shadow-[inset_0_1px_0_rgba(0,0,0,0.1)] after:bg-gradient-to-t after:from-black/10 after:shadow-[inset_0_-1px_0_rgba(0,0,0,0.1)]'
      scrollbarClassName='w-1'
      {...props}>
      <div data-sidebar='content' className='flex flex-col gap-0.5 py-2 pe-0.5 sm:pe-2'>
        {children}
      </div>
    </ScrollArea>
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-sidebar='group'
      className={cn(
        'relative flex w-full min-w-0 flex-col ps-0.5 pe-0 sm:ps-2 sm:pe-2 has-[>[data-state=open]]:pb-2',
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupLabel({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'div'> & { asChild?: boolean }) {
  const Comp = asChild ? SlotPrimitive.Slot : 'div'

  return (
    <Comp
      data-sidebar='group-label'
      className={cn(
        'flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 outline-hidden ring-sidebar-ring transition-[margin,opa] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupAction({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const Comp = asChild ? SlotPrimitive.Slot : 'button'

  return (
    <Comp
      data-sidebar='group-action'
      className={cn(
        'absolute right-3 top-3.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-hidden ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
        // Increases the hit area of the button on mobile.
        'after:absolute after:-inset-2 md:after:hidden',
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-sidebar='group-content' className={cn('w-full text-sm', className)} {...props} />
}

interface SidebarGroupCollapseProps {
  /** Whether the collapsed content is visible. */
  open: boolean
  className?: string
  children: React.ReactNode
}

/**
 * Always-mounted collapse container for sidebar groups and sub-sections.
 * Animates height + opacity + blur with the same spring as `AnimatedCollapsibleContent`,
 * but keeps children mounted so DnD contexts and other always-on subscriptions keep working.
 */
function SidebarGroupCollapse({ open, className, children }: SidebarGroupCollapseProps) {
  return (
    <motion.div
      initial={false}
      animate={{
        height: open ? 'auto' : 0,
        opacity: open ? 1 : 0,
        filter: open ? 'blur(0px)' : 'blur(3px)',
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      style={{ overflow: 'hidden' }}
      className={className}>
      {children}
    </motion.div>
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-sidebar='menu'
      className={cn('flex w-full min-w-0 flex-col gap-0.5', className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li data-sidebar='menu-item' className={cn('group/menu-item relative', className)} {...props} />
  )
}

const sidebarMenuButtonVariants = cva(
  'peer/menu-button flex w-full items-center gap-2 rounded-md p-2 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-data-[sidebar=menu-action]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ',
        dashed:
          'border border-dashed border-primary-300 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ',
        outline:
          'bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]',
      },
      size: {
        default: 'h-8 text-sm',
        sm: 'h-7 text-xs',
        lg: 'h-12 text-sm',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = 'default',
  size = 'default',
  // Accepted for call-site compatibility but no longer rendered — the collapsed-state tooltip
  // only existed for the removed icon mode (the sidebar now slides fully off-canvas).
  tooltip: _tooltip,
  className,
  ...props
}: React.ComponentProps<'button'> & {
  asChild?: boolean
  isActive?: boolean
  tooltip?: string | React.ComponentProps<typeof TooltipContent>
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const Comp = asChild ? SlotPrimitive.Slot : 'button'

  return (
    <Comp
      data-sidebar='menu-button'
      data-size={size}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

function SidebarMenuAction({
  className,
  asChild = false,
  showOnHover = false,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean; showOnHover?: boolean }) {
  const Comp = asChild ? SlotPrimitive.Slot : 'button'

  return (
    <Comp
      data-sidebar='menu-action'
      className={cn(
        'absolute right-1 top-1.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-hidden ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 peer-hover/menu-button:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0',
        // Increases the hit area of the button on mobile.
        'after:absolute after:-inset-2 md:after:hidden',
        'peer-data-[size=sm]/menu-button:top-1',
        'peer-data-[size=default]/menu-button:top-1.5',
        'peer-data-[size=lg]/menu-button:top-2.5',
        showOnHover &&
          'group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 peer-data-[active=true]/menu-button:text-sidebar-accent-foreground md:opacity-0',
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuBadge({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-sidebar='menu-badge'
      className={cn(
        'pointer-events-none absolute right-1 flex h-5 min-w-5 select-none items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums text-sidebar-foreground',
        'peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground',
        'peer-data-[size=sm]/menu-button:top-1',
        'peer-data-[size=default]/menu-button:top-1.5',
        'peer-data-[size=lg]/menu-button:top-2.5',
        className
      )}
      {...props}
    />
  )
}

/**
 * Skeleton placeholder for sidebar menu items during loading.
 * Uses a fixed default width for SSR, then randomizes on client to avoid hydration mismatch.
 */
function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: React.ComponentProps<'div'> & { showIcon?: boolean }) {
  // Default width for SSR - randomized on client after hydration
  const [width, setWidth] = React.useState('70%')

  React.useEffect(() => {
    // Set random width (50-90%) only on client after hydration
    setWidth(`${Math.floor(Math.random() * 40) + 50}%`)
  }, [])

  return (
    <div
      data-sidebar='menu-skeleton'
      className={cn('flex h-8 items-center gap-2 rounded-md px-2', className)}
      {...props}>
      {showIcon && <Skeleton className='size-4 rounded-md' data-sidebar='menu-skeleton-icon' />}
      <Skeleton
        className='h-4 transition-[width] duration-300'
        data-sidebar='menu-skeleton-text'
        style={{ width }}
      />
    </div>
  )
}

function SidebarMenuSub({
  className,
  inset = true,
  ...props
}: React.ComponentProps<'ul'> & {
  /** When false, drop the indent + guide line so sub-rows sit flush under their parent
   * (used where the parent row already conveys grouping, e.g. dispatch route stop lists). */
  inset?: boolean
}) {
  return (
    <ul
      data-sidebar='menu-sub'
      className={cn(
        'flex min-w-0 flex-col gap-0.5 py-0.5',
        inset && 'mx-3.5 translate-x-px border-l border-sidebar-border px-2.5',
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSubItem(props: React.ComponentProps<'li'>) {
  return <li {...props} />
}

function SidebarMenuSubButton({
  asChild = false,
  size = 'md',
  isActive,
  // Accepted for call-site compatibility but no longer rendered (see `SidebarMenuButton`).
  tooltip: _tooltip,
  className,
  ...props
}: React.ComponentProps<'a'> & {
  asChild?: boolean
  size?: 'sm' | 'md'
  isActive?: boolean
  tooltip?: string | React.ComponentProps<typeof TooltipContent>
}) {
  const Comp = asChild ? SlotPrimitive.Slot : 'a'

  return (
    <Comp
      data-sidebar='menu-sub-button'
      data-size={size}
      data-active={isActive}
      className={cn(
        'flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground outline-hidden ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground',
        'data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground',
        size === 'sm' && 'text-xs',
        size === 'md' && 'text-sm',
        className
      )}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupCollapse,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
}
