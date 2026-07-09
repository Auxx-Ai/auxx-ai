// packages/ui/src/components/tooltip.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { CircleX, HelpCircle } from 'lucide-react'
import { Tooltip as TooltipPrimitive } from 'radix-ui'
import * as React from 'react'

/** Tooltip content style variants */
const tooltipContentVariants = cva(
  'z-60 overflow-hidden shadow-md ring-1 ring-inset-1 rounded-md px-3 py-1.5 text-xs animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
  {
    variants: {
      variant: {
        default: 'ring-ring/50 text-foreground dark:text-foreground bg-primary-200',
        destructive: 'ring-destructive/30 text-destructive bg-bad-200/60 backdrop-blur-sm',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

/** TooltipContent props interface */
interface TooltipContentProps
  extends React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>,
    VariantProps<typeof tooltipContentVariants> {}

/** TooltipContent component with variant support */
function TooltipContent({ className, sideOffset = 4, variant, ...props }: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(tooltipContentVariants({ variant }), className)}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}
TooltipContent.displayName = TooltipPrimitive.Content.displayName

/** Check if we're on a touch device - computed once at module load */
const isTouchDevice =
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)

/** Props for the SimpleTooltip convenience wrapper */
interface SimpleTooltipProps {
  children: React.ReactElement
  content?: string
  contentComponent?: React.ReactNode
  /** Optional keyboard shortcut rendered next to the content. */
  shortcut?: string | string[]
  delayDuration?: number
  sideOffset?: number
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  className?: string
  /** Skip preventDefault on pointer events. Use when wrapping interactive elements like a DropdownMenuTrigger. */
  allowInteraction?: boolean
  /** Visual variant of the tooltip */
  variant?: TooltipContentProps['variant']
}

/**
 * Convenience wrapper around the Radix tooltip primitives — pass a trigger as
 * `children` and `content`/`contentComponent` for the bubble. Handles
 * touch-device and click-to-keep-open behavior. Re-exported app-side as
 * `Tooltip` from `~/components/global/tooltip`.
 */
function SimpleTooltip({
  children,
  content,
  contentComponent,
  shortcut,
  sideOffset = 4,
  side,
  align,
  className,
  delayDuration = 300,
  allowInteraction = false,
  variant,
}: SimpleTooltipProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [keepOpen, setKeepOpen] = React.useState(false)

  /** Handles tooltip open/close state changes */
  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      // If keepOpen is true, don't allow closing
      if (keepOpen && !open) return
      setIsOpen(open)
    },
    [keepOpen]
  )

  /** Prevents tooltip from closing on click for non-touch devices */
  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (!isTouchDevice && !allowInteraction) {
        e.preventDefault()
        setKeepOpen(true)
        // Allow normal hover behavior to resume after a moment
        setTimeout(() => setKeepOpen(false), 50)
      }
    },
    [allowInteraction]
  )

  /** Handles mobile toggle behavior — no-op, let clicks pass through */
  const handleClick = React.useCallback((_e: React.MouseEvent) => {
    // On touch devices, don't intercept clicks — tooltips are a hover concept.
    // Let the click propagate to the underlying interactive element.
  }, [])

  /** Prevents closing when clicking the trigger */
  const handlePointerDownOutside = React.useCallback(
    (e: Event) => {
      if (keepOpen) e.preventDefault()
    },
    [keepOpen]
  )

  // Clone the child element and merge our handlers directly onto it
  const trigger = React.cloneElement(children, {
    onPointerDown: (e: React.PointerEvent) => {
      handlePointerDown(e)
      children.props.onPointerDown?.(e)
    },
    onClick: (e: React.MouseEvent) => {
      handleClick(e)
      children.props.onClick?.(e)
    },
  })

  return (
    <Tooltip
      open={isOpen}
      onOpenChange={handleOpenChange}
      delayDuration={delayDuration}
      disableHoverableContent>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent
        sideOffset={sideOffset}
        side={side}
        align={align}
        className={cn('z-[200]', className)}
        variant={variant}
        onPointerDownOutside={handlePointerDownOutside}>
        {contentComponent || (
          <div className='max-w-xs'>
            {content}
            {shortcut && (
              <span className='ml-1 inline-flex items-center gap-1'>
                {Array.isArray(shortcut) ? (
                  shortcut.map((key, index) => (
                    <span
                      key={index}
                      className='text-xs tracking-widest p-0.5 px-1 opacity-60 bg-primary-50 rounded-sm ring-1 ring-primary-300'>
                      {key}
                    </span>
                  ))
                ) : (
                  <span className='text-xs tracking-widest p-0.5 px-1 opacity-60 bg-primary-50 rounded-sm ring-1 ring-primary-300'>
                    {shortcut}
                  </span>
                )}
              </span>
            )}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

/** Tooltip icon size variants */
const tooltipIconVariants = cva('cursor-pointer', {
  variants: { size: { sm: 'h-4 w-4', md: 'h-5 w-5' } },
  defaultVariants: { size: 'sm' },
})

/** Props for TooltipExplanation component */
interface TooltipExplanationProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof tooltipIconVariants> {
  text: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}

/**
 * Help icon with tooltip - displays a HelpCircle icon that shows explanatory text on hover
 */
function TooltipExplanation({ text, size, side, className }: TooltipExplanationProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle className={cn('text-primary-400', tooltipIconVariants({ size }), className)} />
      </TooltipTrigger>
      <TooltipContent side={side}>
        <div className='max-w-xs'>{text}</div>
      </TooltipContent>
    </Tooltip>
  )
}

/** Props for TooltipError component */
interface TooltipErrorProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof tooltipIconVariants> {
  text: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}

/**
 * Error icon with tooltip - displays a CircleX icon that shows error text on hover
 */
function TooltipError({ text, size, side, className }: TooltipErrorProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <CircleX className={cn('text-destructive', tooltipIconVariants({ size }), className)} />
      </TooltipTrigger>
      <TooltipContent variant='destructive' side={side}>
        <div className='max-w-xs'>{text}</div>
      </TooltipContent>
    </Tooltip>
  )
}

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  tooltipContentVariants,
  TooltipExplanation,
  TooltipError,
  SimpleTooltip,
}
export type { TooltipContentProps, TooltipExplanationProps, TooltipErrorProps, SimpleTooltipProps }
