// packages/ui/src/components/tooltip.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { HelpCircle } from 'lucide-react'
import { Tooltip as TooltipPrimitive } from 'radix-ui'
import type * as React from 'react'

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
}

/**
 * Help icon with tooltip - displays a HelpCircle icon that shows explanatory text on hover
 */
function TooltipExplanation({ text, size, className }: TooltipExplanationProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle className={cn('text-primary-400', tooltipIconVariants({ size }), className)} />
      </TooltipTrigger>
      <TooltipContent>
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
}
export type { TooltipContentProps, TooltipExplanationProps }
