'use client'

import {
  Tooltip as ShadcnTooltip,
  TooltipContent,
  type TooltipContentProps,
  TooltipTrigger,
} from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { HelpCircleIcon } from 'lucide-react'
import React, { useCallback, useState } from 'react'

/** Check if we're on a touch device - computed once at module load */
const isTouchDevice =
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)

/** Tooltip component props */
interface TooltipProps {
  children: React.ReactElement
  content?: string
  contentComponent?: React.ReactNode
  shortcut?: string | string[] // Optional prop for displaying a keyboard shortcut
  delayDuration?: number
  sideOffset?: number
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  className?: string
  /** Skip preventDefault on pointer events. Use when Tooltip wraps interactive elements like DropdownMenuTrigger */
  allowInteraction?: boolean
  /** Visual variant of the tooltip */
  variant?: TooltipContentProps['variant']
}

export const Tooltip = ({
  children,
  content,
  contentComponent,
  shortcut,
  sideOffset = 4,
  side,
  align,
  className,
  allowInteraction = false,
  variant,
}: TooltipProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [keepOpen, setKeepOpen] = useState(false)

  /** Handles tooltip open/close state changes */
  const handleOpenChange = useCallback(
    (open: boolean) => {
      // If keepOpen is true, don't allow closing
      if (keepOpen && !open) return
      setIsOpen(open)
    },
    [keepOpen]
  )

  /** Prevents tooltip from closing on click for non-touch devices */
  const handlePointerDown = useCallback(
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
  const handleClick = useCallback((_e: React.MouseEvent) => {
    // On touch devices, don't intercept clicks — tooltips are a hover concept.
    // Let the click propagate to the underlying interactive element.
  }, [])

  /** Prevents closing when clicking the trigger */
  const handlePointerDownOutside = useCallback(
    (e: Event) => {
      if (keepOpen) e.preventDefault()
    },
    [keepOpen]
  )

  // Clone the child element and merge our handlers directly onto it
  const trigger = React.cloneElement(children, {
    onPointerDown: (e: React.PointerEvent) => {
      handlePointerDown(e)
      // Call original handler if it exists
      children.props.onPointerDown?.(e)
    },
    onClick: (e: React.MouseEvent) => {
      handleClick(e)
      // Call original handler if it exists
      children.props.onClick?.(e)
    },
  })

  return (
    <ShadcnTooltip open={isOpen} onOpenChange={handleOpenChange} disableHoverableContent>
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
    </ShadcnTooltip>
  )
}

const tooltipIconVariants = cva('cursor-pointer', {
  variants: { size: { sm: 'h-4 w-4', md: 'h-5 w-5' } },
  defaultVariants: { size: 'sm' },
})

interface TooltipExplanationProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof tooltipIconVariants> {
  text: string
}

export function TooltipExplanation({ text, size, className }: TooltipExplanationProps) {
  return (
    <Tooltip content={text}>
      <HelpCircleIcon
        className={cn('text-primary-400', tooltipIconVariants({ size }), className)}
      />
    </Tooltip>
  )
}
