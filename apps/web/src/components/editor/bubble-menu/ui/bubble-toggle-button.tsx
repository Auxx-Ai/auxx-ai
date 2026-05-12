// apps/web/src/components/editor/bubble-menu/ui/bubble-toggle-button.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import type { ButtonHTMLAttributes } from 'react'
import { forwardRef } from 'react'

interface BubbleToggleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
}

/** Single, dense toggle button used inside the bubble menu. */
export const BubbleToggleButton = forwardRef<HTMLButtonElement, BubbleToggleButtonProps>(
  function BubbleToggleButton({ className, active, type, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        data-state={active ? 'on' : 'off'}
        // Stop mousedown from blurring the editor — the bubble must stay open
        // while the user clicks its buttons.
        onMouseDown={(e) => {
          e.preventDefault()
          rest.onMouseDown?.(e)
        }}
        className={cn(
          'inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-1.5 text-xs',
          'text-foreground/70 transition-colors',
          'hover:bg-foreground/10 hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'data-[state=on]:bg-primary/15 data-[state=on]:text-primary data-[state=on]:ring-1 data-[state=on]:ring-primary/30',
          'disabled:pointer-events-none disabled:opacity-50',
          '[&>svg]:size-3.5 [&>svg]:shrink-0',
          className
        )}
        {...rest}>
        {children}
      </button>
    )
  }
)
