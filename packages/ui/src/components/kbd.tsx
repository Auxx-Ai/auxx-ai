// packages/ui/src/components/kbd.tsx
import * as React from 'react'
import { Command, ChevronUp, CornerDownLeft, Option } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { isMac } from '@auxx/utils'

import { cn } from '@auxx/ui/lib/utils'

/** Maps shortcut keys to Lucide icons or text strings */
const SHORTCUT_MAP = {
  command: Command,
  cmd: Command,
  ctrl: ChevronUp,
  esc: 'esc',
  enter: CornerDownLeft,
  alt: Option,
  option: Option,
} as const

type ShortcutKey = keyof typeof SHORTCUT_MAP

/** Variants for KbdGroup container */
const kbdGroupVariants = cva(
  'pointer-events-none ring-1 inline-flex items-center justify-center gap-0.5 font-sans text-xs font-medium select-none',
  {
    variants: {
      variant: {
        default: 'bg-background/5 ring-background/40  text-white rounded-sm',
        outline: ' ring-ring/50 text-muted-foreground/80 rounded-sm',
        ghost: 'ring-ring/50 text-muted-foreground/80 rounded-sm',
      },
      size: {
        default: 'h-5 min-w-5 px-1',
        sm: 'h-4 min-w-4 px-0.5 text-[10px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

type KbdGroupVariantProps = VariantProps<typeof kbdGroupVariants>

/** Context to detect if Kbd is inside a KbdGroup */
const KbdGroupContext = React.createContext(false)

interface KbdGroupProps extends React.ComponentProps<'kbd'>, KbdGroupVariantProps {}

/** Container for keyboard shortcuts with variant styling */
function KbdGroup({ className, variant, size, ...props }: KbdGroupProps) {
  return (
    <KbdGroupContext.Provider value={true}>
      <kbd
        data-slot="kbd-group"
        className={cn(
          kbdGroupVariants({ variant, size }),
          "[&_svg:not([class*='size-'])]:size-3",
          '[[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-inherit dark:[[data-slot=tooltip-content]_&]:bg-background/10',
          className
        )}
        {...props}
      />
    </KbdGroupContext.Provider>
  )
}

interface KbdProps extends Omit<React.ComponentProps<'span'>, 'children'>, KbdGroupVariantProps {
  /** Predefined shortcut key - renders the appropriate icon or text */
  shortcut?: ShortcutKey
  /** Custom content */
  children?: React.ReactNode
}

/** Renders a shortcut as icon or text */
function renderShortcut(key: ShortcutKey): React.ReactNode {
  const value = SHORTCUT_MAP[key]
  if (typeof value === 'string') {
    return value
  }
  const Icon = value
  return <Icon />
}

/** Individual keyboard key - auto-wraps in KbdGroup if standalone */
function Kbd({ className, shortcut, children, variant, size, ...props }: KbdProps) {
  const isInsideGroup = React.useContext(KbdGroupContext)
  const content = children ?? (shortcut ? renderShortcut(shortcut) : null)

  const kbdElement = (
    <span
      data-slot="kbd"
      className={cn('inline-flex items-center justify-center', className)}
      {...props}>
      {content}
    </span>
  )

  // If standalone, wrap in KbdGroup
  if (!isInsideGroup) {
    return (
      <KbdGroup variant={variant} size={size}>
        {kbdElement}
      </KbdGroup>
    )
  }

  return kbdElement
}

interface KbdSubmitProps extends KbdGroupVariantProps {
  className?: string
}

/**
 * Keyboard shortcut hint for dialog submit action.
 * Shows Cmd+Enter on Mac, Ctrl+Enter on Windows/Linux.
 * Requires the IS_MAC_SCRIPT in <head> for SSR compatibility.
 */
function KbdSubmit({ variant, size, className }: KbdSubmitProps) {
  return (
    <KbdGroup variant={variant} size={size} className={className}>
      <Kbd shortcut={isMac() ? 'cmd' : 'ctrl'} />
      <Kbd shortcut="enter" />
    </KbdGroup>
  )
}

export { Kbd, KbdGroup, KbdSubmit, kbdGroupVariants, type ShortcutKey, type KbdGroupVariantProps }
