// apps/homepage/src/app/platform/ai/_mocks/mock-main-page.tsx

import { cn } from '~/lib/utils'
import { MockPanelFrame } from './mock-panel-frame'

interface MockMainPageProps {
  className?: string
  /** Optional header rendered above the panel frame (e.g. a `MockKopilotHeader`).
   *  Sits flat inside the page padding; the panel frame below it can be lifted
   *  in 3D independently. */
  header?: React.ReactNode
  /** When true, MockMainPage does NOT wrap children in `MockPanelFrame` — caller
   *  is responsible for rendering the frame (useful when the panel frame itself
   *  needs to be animated/transformed by the caller). Default `false`. */
  noPanelFrame?: boolean
  children: React.ReactNode
}

/**
 * Static facsimile of `packages/ui/src/components/main-page.tsx`.
 *
 * Outer container reproduces the real `MainPage`'s padded frame
 * (`bg-neutral-100 dark:bg-background p-3 pt-0`) and wraps its content in a
 * `MockPanelFrame` for the nested-border depth effect.
 */
export function MockMainPage({
  className,
  header,
  noPanelFrame = false,
  children,
}: MockMainPageProps) {
  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-mock-page-bg p-3 pt-3',
        className
      )}>
      {header}
      {noPanelFrame ? children : <MockPanelFrame flex>{children}</MockPanelFrame>}
    </div>
  )
}
