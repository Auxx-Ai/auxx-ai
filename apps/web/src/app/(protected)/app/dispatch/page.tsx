// apps/web/src/app/(protected)/app/dispatch/page.tsx

import { DispatchBoard } from '~/components/dispatch/ui/board/dispatch-board'

/**
 * Module home — the M2a dispatch board (07-m2-build.md §D.2). `DispatchBoard` renders
 * `MainPageContent` itself (schedule-page pattern) so the route planner's Routes drawer can
 * dock into its panel frame.
 */
export default function DispatchHome() {
  return <DispatchBoard />
}
