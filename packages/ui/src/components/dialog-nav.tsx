// packages/ui/src/components/dialog-nav.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DialogDescription,
  DialogHeader,
  type DialogSize,
  DialogTitle,
  dialogSizeRem,
} from '@auxx/ui/components/dialog'
import { Separator } from '@auxx/ui/components/separator'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronLeft } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Children,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

/** App-wide spring used for dialog page transitions (matches tree-row/collapsible). */
const SPRING = { type: 'spring', stiffness: 300, damping: 30 } as const

// ── DialogNav (breadcrumb + back header) ─────────────────────────────────────

export interface DialogNavCrumb {
  label: ReactNode
  /** Set to make the crumb a clickable jump (back or forward). */
  onClick?: () => void
  /**
   * Mark this crumb as the current page (highlighted, non-interactive). When no
   * crumb sets `active`, the **last** crumb is treated as current. Set it to show
   * every destination at once and let the active one be any of them — e.g. a
   * bidirectional `Setup › Mapping` header where either side can be current.
   */
  active?: boolean
  icon?: ReactNode
}

export interface DialogNavProps {
  /** sr-only DialogTitle (required by Radix Dialog for a11y). */
  title: string
  /** sr-only DialogDescription. */
  description?: string
  /**
   * A visible leading label before the crumbs (e.g. "Help"), separated from them
   * by a divider. Use when the crumbs act as tabs and you still want a fixed
   * dialog title in front of them.
   */
  heading?: ReactNode
  crumbs: DialogNavCrumb[]
  /** Renders the leading "‹ Back" button when provided. */
  onBack?: () => void
  backDisabled?: boolean
  /** Right-aligned slot — e.g. a step indicator. */
  actions?: ReactNode
  className?: string
}

/**
 * Standard dialog navigation header: an optional Back button + a breadcrumb
 * trail, in the `h-10 border-b` bar shared by the template/gallery dialogs and
 * the wizard flows. Replaces the hand-rolled headers so they stay consistent.
 * The last crumb renders as the current (non-interactive) page.
 */
export function DialogNav({
  title,
  description,
  heading,
  crumbs,
  onBack,
  backDisabled,
  actions,
  className,
}: DialogNavProps) {
  // When no crumb marks itself active, fall back to "last crumb is current".
  const hasExplicitActive = crumbs.some((c) => c.active)
  return (
    <DialogHeader
      className={cn(
        // space-y-0 cancels DialogHeader's space-y-1.5, which would otherwise
        // push the actions slot down (margin-top on the second flex-row child).
        // shrink-0 keeps the bar from compressing when the body becomes a flex child.
        'mb-0 flex h-10 shrink-0 flex-row items-center justify-between space-y-0 border-b px-3',
        className
      )}>
      <div className='flex items-center gap-1'>
        {onBack && (
          <>
            <Button variant='ghost' size='sm' onClick={onBack} disabled={backDisabled}>
              <ChevronLeft />
              Back
            </Button>
            <Separator orientation='vertical' className='h-5' />
          </>
        )}
        {heading && (
          <>
            <span className='px-2 font-medium text-foreground text-sm'>{heading}</span>
            {crumbs.length > 0 && <Separator orientation='vertical' className='h-5' />}
          </>
        )}
        {crumbs.map((crumb, i) => {
          const isCurrent = hasExplicitActive ? !!crumb.active : i === crumbs.length - 1
          return (
            <Fragment key={i}>
              {i > 0 && <Separator orientation='vertical' className='h-5' />}
              <Button
                variant='ghost'
                size='sm'
                onClick={crumb.onClick}
                disabled={isCurrent || !crumb.onClick}
                className={isCurrent ? 'pointer-events-none' : undefined}>
                {crumb.icon}
                {crumb.label}
              </Button>
            </Fragment>
          )
        })}
        <DialogTitle className='sr-only'>{title}</DialogTitle>
        {description && <DialogDescription className='sr-only'>{description}</DialogDescription>}
      </div>
      {actions && <div className='flex items-center'>{actions}</div>}
    </DialogHeader>
  )
}

// ── DialogNavPages (controlled, size-animated page switcher) ──────────────────

export interface DialogNavPageProps {
  value: string
  /**
   * Declared page width, reusing the `DialogContent` size tokens (`max-w-*`). The
   * wrapper springs to the matching rem width; defaults to `'sm'`. Because the
   * tokens are max-widths, the page still shrinks on mobile (capped at 95vw).
   */
  size?: DialogSize
  children: ReactNode
}

/** A single page within `DialogNavPages`. Rendered only when active. */
export function DialogNavPage({ children }: DialogNavPageProps) {
  return <>{children}</>
}

export interface DialogNavPagesProps {
  /** Active page key (controlled by the parent). */
  value: string
  children: ReactNode
  className?: string
}

/**
 * Controlled page switcher that springs the dialog body between steps in both
 * dimensions: width is declared per page (`DialogNavPage size`) and animated to
 * the matching rem; height is measured and animated to fit the active page's
 * content. The active page crossfades in. Pair with a `DialogContent
 * size='content'` shell so the card width follows the animating body.
 */
export function DialogNavPages({ value, children, className }: DialogNavPagesProps) {
  const [height, setHeight] = useState<number | 'auto'>('auto')
  const ref = useRef<HTMLDivElement>(null)
  // The first measured height (from the observer, post-paint) must snap, not
  // spring — otherwise the `'auto' → measured` delta settles visibly on open.
  // Flipped true after the first numeric height commits; every change after springs.
  const measuredOnce = useRef(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (typeof height === 'number') measuredOnce.current = true
  }, [height])

  // Flatten one level of fragments so callers can group pages conditionally
  // ({cond ? <>…pages…</> : <>…pages…</>}) — Children.toArray leaves fragments
  // intact, which would hide their pages from the value match below.
  const pages = Children.toArray(children)
    .flatMap((child) =>
      isValidElement(child) && child.type === Fragment
        ? Children.toArray((child.props as { children?: ReactNode }).children)
        : [child]
    )
    .filter(isValidElement) as ReactElement<DialogNavPageProps>[]
  const active = pages.find((page) => page.props.value === value)
  const widthRem = dialogSizeRem[active?.props.size ?? 'sm']

  return (
    <motion.div
      // Start at the first page's size — without this the body tweens open on
      // mount (on top of the dialog's own open animation). Step changes still spring.
      initial={false}
      animate={{ width: `${widthRem}rem`, height }}
      transition={{ width: SPRING, height: measuredOnce.current ? SPRING : { duration: 0 } }}
      style={{ maxWidth: '95vw' }}
      // On mobile, override the JS-driven rem width / 95vw cap so the body fills
      // the full-width `content` shell edge-to-edge, and override the animated
      // height so it fills the full-height shell instead of measuring to content.
      // The bang beats the inline `width`/`maxWidth`/`height`; desktop (sm+) keeps
      // the width + height springs.
      className={cn(
        'relative overflow-hidden max-sm:w-full! max-sm:max-w-full! max-sm:h-full! max-sm:min-h-0',
        // A DialogFooter placed *inside* a DialogNavPage has no surrounding
        // gutter: the page supplies its own `p-4` around the body content, but
        // the footer is a sibling of that body, so its buttons sit flush against
        // the (rounded, overflow-hidden) card edges and get clipped. Re-apply the
        // dialog's standard `p-4` gutter to any nested footer via its data-slot.
        // Footers rendered as a *sibling* of DialogNavPages (the common wizard
        // layout) aren't descendants, so they keep their own padding untouched.
        '[&_[data-slot=dialog-footer]]:px-4 [&_[data-slot=dialog-footer]]:pb-4',
        className
      )}>
      {/* Stable measuring wrapper: the keyed page below remounts on every change,
          so the ResizeObserver can't live on it. The exiting page is positioned
          absolutely, so this wrapper's height tracks the active page. */}
      <div ref={ref} className='max-sm:h-full max-sm:min-h-0'>
        <AnimatePresence mode='popLayout' initial={false}>
          <motion.div
            key={value}
            className='w-full max-sm:flex max-sm:h-full max-sm:min-h-0 max-sm:flex-col'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, position: 'absolute', inset: 0 }}
            transition={{ duration: 0.15 }}>
            {active}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
