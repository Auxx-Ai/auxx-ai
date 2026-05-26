// apps/homepage/src/app/platform/ai/_mocks/mock-panel-frame.tsx

import { cn } from '~/lib/utils'

interface MockPanelFrameProps {
  width?: number | string
  flex?: boolean
  className?: string
  children: React.ReactNode
}

/**
 * Static facsimile of `packages/ui/src/components/panel-frame.tsx`.
 * Reproduces the four-layer nested border depth effect (alternating
 * highlight/shadow rings) that wraps every main panel in the real app.
 */
export function MockPanelFrame({ width, flex, className, children }: MockPanelFrameProps) {
  const inlineStyle =
    width !== undefined ? { width: typeof width === 'number' ? `${width}px` : width } : undefined

  return (
    <div
      style={inlineStyle}
      className={cn(
        'relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-mock-panel-border-1 bg-mock-panel-bg',
        flex ? 'flex-1' : 'shrink-0',
        className
      )}>
      <div className='flex min-h-0 flex-1 flex-col rounded-[calc(var(--radius-2xl)-1px)] border border-mock-panel-border-2'>
        <div className='flex min-h-0 flex-1 rounded-[calc(var(--radius-2xl)-2px)] border border-mock-panel-border-3'>
          <div className='flex min-h-0 flex-1 rounded-[calc(var(--radius-2xl)-3px)] border border-mock-panel-border-4'>
            <div className='flex min-h-0 flex-1 flex-col overflow-clip rounded-[calc(var(--radius-2xl)-4px)] bg-clip-padding'>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
