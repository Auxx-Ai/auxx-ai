// packages/ui/src/components/nav-stack.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  Children,
  createContext,
  isValidElement,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'

/** App-wide spring. `damping: 38` is past critical (~35 at this stiffness) so the
 * panel settles cleanly with no end-bounce/overshoot, while staying snappy. */
const SPRING = { type: 'spring', stiffness: 300, damping: 38 } as const

/** Parallax depth: the back screen travels this far while the front travels 100%. Tune on device. */
const PARALLAX = '-30%'
/** The back/inactive screen recedes to this opacity. Drop to 1 to disable dimming. */
const DIM = 0.6

// ── Variants ─────────────────────────────────────────────────────────────────
//
// A single `AnimatePresence` keyed by the top key renders two panels during a
// transition — the entering top and the exiting previous-top — which is exactly
// the "front sheet + back screen" pair the parallax moves between.
//
// forward (push): entering = front (slides in from the right, full travel, full
//   opacity); exiting = back (parallaxes left, dims).
// back (pop):     entering = back (slides from the left, dim → full); exiting =
//   front (slides off to the right, stays full opacity).

type Direction = 'forward' | 'back'

const slideVariants = {
  enter: (dir: Direction) => ({
    x: dir === 'forward' ? '100%' : PARALLAX,
    opacity: dir === 'forward' ? 1 : DIM,
  }),
  center: { x: '0%', opacity: 1 },
  exit: (dir: Direction) => ({
    x: dir === 'forward' ? PARALLAX : '100%',
    opacity: dir === 'forward' ? DIM : 1,
  }),
}

/** Reduced-motion fallback: crossfade only, no horizontal travel (matches `dialog-nav`). */
const fadeVariants = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0 },
}

/** Shared-bar content: the iOS title/back-button cross-slide (small travel + fade). */
const barVariants = {
  enter: (dir: Direction) => ({ x: dir === 'forward' ? '30%' : '-30%', opacity: 0 }),
  center: { x: '0%', opacity: 1 },
  exit: (dir: Direction) => ({ x: dir === 'forward' ? '-30%' : '30%', opacity: 0 }),
}

// ── Context ──────────────────────────────────────────────────────────────────

interface NavStackContextValue {
  stack: string[]
  top: string
  direction: Direction
  push: (key: string) => void
  pop: () => void
}

interface PanelDecl {
  value: string
  bar?: ReactNode
  children: ReactNode
  className?: string
}

const NavStackContext = createContext<NavStackContextValue | null>(null)
const PanelsContext = createContext<PanelDecl[]>([])

/** Read/drive the stack from anywhere inside a `<NavStack>`. */
export function useNavStack(): NavStackContextValue {
  const ctx = useContext(NavStackContext)
  if (!ctx) throw new Error('useNavStack must be used within a <NavStack>')
  return ctx
}

function usePanels(): PanelDecl[] {
  return useContext(PanelsContext)
}

// ── NavStack (provider) ──────────────────────────────────────────────────────

export interface NavStackProps {
  children: ReactNode
  /** Uncontrolled initial stack (default: the first declared panel's value). */
  defaultStack?: string[]
  /** Controlled stack (top = last). Provide with `onStackChange` to drive externally. */
  stack?: string[]
  onStackChange?: (next: string[]) => void
  className?: string
}

/**
 * iOS-style push/pop navigation stack. Holds a stack of string keys (top = last);
 * declare one `<NavStackPanel value="…">` per level and the stack selects which
 * is on top. Push slides the next screen in from the right while the current one
 * parallaxes left; pop reverses it. Content-agnostic — see `plans/ui/nav-stack.md`.
 */
export function NavStack({
  children,
  defaultStack,
  stack: controlledStack,
  onStackChange,
  className,
}: NavStackProps) {
  const panels = useMemo(() => collectPanels(children), [children])

  const [internalStack, setInternalStack] = useState<string[]>(() => {
    if (defaultStack) return defaultStack
    const first = panels[0]?.value
    return first ? [first] : []
  })
  const isControlled = controlledStack !== undefined
  const stack = isControlled ? controlledStack : internalStack

  const setStack = (next: string[]) => {
    if (isControlled) onStackChange?.(next)
    else setInternalStack(next)
  }

  // Direction is inferred from the last stack change. The "store previous value
  // during render" pattern keeps it correct on the same render the stack changes,
  // so `AnimatePresence` animates with the right direction from the first frame.
  const prevStackRef = useRef<string[]>(stack)
  const dirRef = useRef<Direction>('forward')
  const prev = prevStackRef.current
  if (prev.length !== stack.length || prev.some((k, i) => k !== stack[i])) {
    dirRef.current = stack.length < prev.length ? 'back' : 'forward'
    prevStackRef.current = stack
  }

  const top = stack[stack.length - 1] ?? ''
  const ctx: NavStackContextValue = {
    stack,
    top,
    direction: dirRef.current,
    push: (key) => setStack([...stack, key]),
    pop: () => {
      if (stack.length > 1) setStack(stack.slice(0, -1))
    },
  }

  return (
    <NavStackContext.Provider value={ctx}>
      <PanelsContext.Provider value={panels}>
        <div className={className}>{children}</div>
      </PanelsContext.Provider>
    </NavStackContext.Provider>
  )
}

/** Walk the declared tree and collect every `<NavStackPanel>` in document order. */
function collectPanels(children: ReactNode, acc: PanelDecl[] = []): PanelDecl[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    if (child.type === NavStackPanel) {
      const p = child.props as NavStackPanelProps
      acc.push({ value: p.value, bar: p.bar, children: p.children, className: p.className })
      return
    }
    const nested = (child.props as { children?: ReactNode } | null)?.children
    if (nested) collectPanels(nested, acc)
  })
  return acc
}

// ── NavStackPanel (declaration) ──────────────────────────────────────────────

export interface NavStackPanelProps {
  value: string
  /** Bar content consumed by a sibling `<NavStackBar>`. Ignored if no `<NavStackBar>`. */
  bar?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * Declares one level of the stack. Pure declaration — its content is rendered by
 * the sibling `<NavStackPanels>` (and `bar` by `<NavStackBar>`), not here.
 */
export function NavStackPanel(_props: NavStackPanelProps) {
  return null
}

// ── NavStackPanels (the slider) ──────────────────────────────────────────────

export interface NavStackPanelsProps {
  children: ReactNode
  className?: string
}

/**
 * The horizontal slider. `relative overflow-hidden`; renders the top panel and,
 * during a transition, the panel beneath it (the parallax target). Does not
 * manage its own scroll or height — the active panel's content defines the
 * height; place inside a parent `ScrollArea`.
 *
 * Note: this clips both axes, so a `position: sticky` bar must NOT live inside a
 * panel — it would stick to this (unscrollable) box and scroll away. Put the bar
 * outside, in a sticky `<NavStackBar>`, so it pins to the outer `ScrollArea`.
 */
export function NavStackPanels({ className }: NavStackPanelsProps) {
  const { top, direction } = useNavStack()
  const panels = usePanels()
  const reduce = useReducedMotion()
  const active = panels.find((p) => p.value === top)
  const variants = reduce ? fadeVariants : slideVariants

  // Stack panels by their declaration order (= depth): the deeper panel always
  // sits above the shallower one, so the FRONT screen occludes the BACK during
  // BOTH push and pop. Without this, the in-flow (entering) panel and the
  // popLayout-absolute (leaving) panel have no defined order and bleed through
  // each other. `relative` is required for z-index to apply to the in-flow panel.
  const activeIndex = Math.max(
    0,
    panels.findIndex((p) => p.value === top)
  )

  return (
    <div className={cn('relative overflow-hidden', className)}>
      <AnimatePresence mode='popLayout' initial={false} custom={direction}>
        <motion.div
          key={top}
          custom={direction}
          variants={variants}
          initial='enter'
          animate='center'
          exit='exit'
          transition={reduce ? { duration: 0.15 } : SPRING}
          style={{ zIndex: activeIndex }}
          className={cn(
            'relative w-full bg-background shadow-[-8px_0_24px_rgba(0,0,0,0.08)]',
            active?.className
          )}>
          {active?.children}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ── NavStackBar (shared-bar layout) ──────────────────────────────────────────

export interface NavStackBarProps {
  className?: string
}

/**
 * Persistent bar frame for the shared-bar layout. The frame stays put while only
 * its content — each panel's `bar` prop — cross-animates with the push/pop. Omit
 * entirely for the per-panel-bar layout (where each panel carries its own bar in
 * `children` and slides as one unit).
 */
export function NavStackBar({ className }: NavStackBarProps) {
  const { top, direction } = useNavStack()
  const panels = usePanels()
  const reduce = useReducedMotion()
  const active = panels.find((p) => p.value === top)
  const variants = reduce ? fadeVariants : barVariants

  return (
    <div className={cn('relative', className)}>
      <AnimatePresence mode='popLayout' initial={false} custom={direction}>
        <motion.div
          key={top}
          custom={direction}
          variants={variants}
          initial='enter'
          animate='center'
          exit='exit'
          transition={reduce ? { duration: 0.15 } : SPRING}>
          {active?.bar}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
