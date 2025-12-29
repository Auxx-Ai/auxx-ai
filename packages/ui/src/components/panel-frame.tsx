// packages/ui/src/components/panel-frame.tsx
'use client'

import * as React from 'react'
import { cn } from '@auxx/ui/lib/utils'

/**
 * Props for PanelFrame component
 */
interface PanelFrameProps extends React.ComponentProps<'div'> {
  /** Width of the panel - can be number (px) or string (CSS value) */
  width?: number | string
  /** Whether this panel should flex to fill available space */
  flex?: boolean
  /** Whether to shrink or not */
  shrink?: boolean
}

/**
 * PanelFrame - Reusable container with nested border styling.
 * Used for main content areas and docked panels.
 */
function PanelFrame({
  className,
  children,
  width,
  flex = false,
  shrink = true,
  style,
  ...props
}: PanelFrameProps) {
  return (
    <div
      className={cn(
        'relative flex flex-col min-w-0 overflow-hidden h-full bg-muted/50 rounded-2xl border border-white/60 dark:border-white/10',
        flex && 'flex-1',
        shrink ? 'shrink-0' : 'shrink',
        className
      )}
      style={{
        ...(width !== undefined && { width: typeof width === 'number' ? `${width}px` : width }),
        ...style,
      }}
      {...props}>
      {/* Nested borders for depth effect */}
      <div className="flex flex-1 min-h-0 min-w-0 flex-col rounded-[calc(var(--radius-2xl)-1px)] border dark:border-neutral-900/80 border-black/10">
        <div className="flex flex-1 min-h-0 border dark:border-neutral-950 border-white/50 rounded-[calc(var(--radius-2xl)-2px)]">
          <div className="flex flex-1 min-h-0 border dark:border-neutral-900/70 border-neutral-950/20 rounded-[calc(var(--radius-2xl)-3px)]">
            <div className="flex flex-1 flex-col min-h-0 bg-clip-padding rounded-[calc(var(--radius-2xl)-4px)] overflow-clip">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

PanelFrame.displayName = 'PanelFrame'

export { PanelFrame, type PanelFrameProps }
