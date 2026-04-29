// packages/ui/src/components/collapsible.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Collapsible as CollapsiblePrimitive } from 'radix-ui'
import type React from 'react'

const Collapsible = CollapsiblePrimitive.Root

const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger

const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent

export interface AnimatedCollapsibleContentProps {
  /** Controls whether the content is visible. */
  open: boolean
  /** When false, open/close changes apply instantly without animation. */
  animate?: boolean
  className?: string
  children?: React.ReactNode
}

/**
 * Animated collapse/expand container. Drop-in replacement for a conditional
 * render — animates height + opacity + blur on mount/unmount using the shared
 * spring transition.
 */
function AnimatedCollapsibleContent({
  open,
  animate = true,
  className,
  children,
}: AnimatedCollapsibleContentProps) {
  if (!animate) {
    return open ? <div className={className}>{children}</div> : null
  }
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0, filter: 'blur(3px)', overflow: 'hidden' }}
          animate={{
            height: 'auto',
            opacity: 1,
            filter: 'blur(0px)',
            overflow: 'hidden',
            transitionEnd: { overflow: 'visible' },
          }}
          exit={{ height: 0, opacity: 0, filter: 'blur(3px)', overflow: 'hidden' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className={className}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export interface CollapsibleChevronProps {
  /** Current open state — drives the rotation. */
  open: boolean
  /**
   * `'right'` (default): ChevronRight, rotates 0 → 90° when opened.
   * `'down'`: ChevronDown, rotates 0 → 180° when opened.
   */
  direction?: 'right' | 'down'
  className?: string
}

/**
 * Chevron that animates its rotation when an adjacent collapsible opens/closes.
 * Matches the spring transition used throughout the app.
 */
function CollapsibleChevron({ open, direction = 'right', className }: CollapsibleChevronProps) {
  const Icon = direction === 'down' ? ChevronDown : ChevronRight
  const rotation = direction === 'down' ? 180 : 90
  return (
    <motion.span
      animate={{ rotate: open ? rotation : 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className='inline-flex'>
      <Icon className={cn('size-4', className)} />
    </motion.span>
  )
}

export {
  AnimatedCollapsibleContent,
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleTrigger,
}
