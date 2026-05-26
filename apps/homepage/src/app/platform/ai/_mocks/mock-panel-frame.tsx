// apps/homepage/src/app/platform/ai/_mocks/mock-panel-frame.tsx

import { cn } from '~/lib/utils'

interface MockPanelFrameProps {
  width?: number | string
  flex?: boolean
  className?: string
  /** When true, swaps overflow-hidden/clip for overflow-visible on every nested
   *  ring + enables transform-3d so 3D-translated children aren't flattened. */
  allowOverflow?: boolean
  children: React.ReactNode
}

/**
 * Static facsimile of `packages/ui/src/components/panel-frame.tsx`.
 * Reproduces the four-layer nested border depth effect (alternating
 * highlight/shadow rings) that wraps every main panel in the real app.
 */
export function MockPanelFrame({
  width,
  flex,
  className,
  allowOverflow = false,
  children,
}: MockPanelFrameProps) {
  const inlineStyle =
    width !== undefined ? { width: typeof width === 'number' ? `${width}px` : width } : undefined
  const overflowOuter = allowOverflow ? 'overflow-visible transform-3d' : 'overflow-hidden'
  const overflowInner = allowOverflow ? 'overflow-visible transform-3d' : 'overflow-clip'

  return (
    <div
      style={inlineStyle}
      className={cn(
        'relative flex h-full min-h-0 min-w-0 flex-col rounded-2xl border border-mock-panel-border-1 bg-mock-panel-bg',
        overflowOuter,
        flex ? 'flex-1' : 'shrink-0',
        className
      )}>
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col rounded-[calc(var(--radius-2xl)-1px)] border border-mock-panel-border-2',
          allowOverflow && 'transform-3d'
        )}>
        <div
          className={cn(
            'flex min-h-0 flex-1 rounded-[calc(var(--radius-2xl)-2px)] border border-mock-panel-border-3',
            allowOverflow && 'transform-3d'
          )}>
          <div
            className={cn(
              'flex min-h-0 flex-1 rounded-[calc(var(--radius-2xl)-3px)] border border-mock-panel-border-4',
              allowOverflow && 'transform-3d'
            )}>
            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col rounded-[calc(var(--radius-2xl)-4px)] bg-clip-padding',
                overflowInner
              )}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
