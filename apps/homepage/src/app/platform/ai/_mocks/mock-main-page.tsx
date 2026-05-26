// apps/homepage/src/app/platform/ai/_mocks/mock-main-page.tsx

import { cn } from '~/lib/utils'
import { MockPanelFrame } from './mock-panel-frame'

interface MockMainPageProps {
  className?: string
  /** When true, swaps `overflow-hidden` for `overflow-visible` and enables
   *  `transform-3d` so 3D-translated children render beyond the panel bounds.
   *  Forwarded to the inner `MockPanelFrame`. Default `false`. */
  allowOverflow?: boolean
  children: React.ReactNode
}

/**
 * Static facsimile of `packages/ui/src/components/main-page.tsx`.
 *
 * Outer container reproduces the real `MainPage`'s padded frame
 * (`bg-neutral-100 dark:bg-background p-3 pt-0`) and wraps its content in a
 * `MockPanelFrame` for the nested-border depth effect.
 */
export function MockMainPage({ className, allowOverflow = false, children }: MockMainPageProps) {
  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-1 flex-col bg-mock-page-bg p-3 pt-3',
        allowOverflow ? 'overflow-visible transform-3d' : 'overflow-hidden',
        className
      )}>
      <MockPanelFrame flex allowOverflow={allowOverflow}>
        {children}
      </MockPanelFrame>
    </div>
  )
}
