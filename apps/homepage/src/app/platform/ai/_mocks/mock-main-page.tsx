// apps/homepage/src/app/platform/ai/_mocks/mock-main-page.tsx

import { cn } from '~/lib/utils'
import { MockPanelFrame } from './mock-panel-frame'

interface MockMainPageProps {
  className?: string
  children: React.ReactNode
}

/**
 * Static facsimile of `packages/ui/src/components/main-page.tsx`.
 *
 * Outer container reproduces the real `MainPage`'s padded frame
 * (`bg-neutral-100 dark:bg-background p-3 pt-0`) and wraps its content in a
 * `MockPanelFrame` for the nested-border depth effect.
 */
export function MockMainPage({ className, children }: MockMainPageProps) {
  return (
    <div
      className={cn(
        'flex h-full flex-1 flex-col overflow-hidden bg-mock-page-bg p-3 pt-3',
        className
      )}>
      <MockPanelFrame flex>{children}</MockPanelFrame>
    </div>
  )
}
