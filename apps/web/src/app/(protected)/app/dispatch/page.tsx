// apps/web/src/app/(protected)/app/dispatch/page.tsx

import { MainPageContent } from '@auxx/ui/components/main-page'
import { DispatchBoard } from '~/components/dispatch/ui/board/dispatch-board'

/** Module home — the M2a dispatch board (07-m2-build.md §D.2). */
export default function DispatchHome() {
  return (
    <MainPageContent>
      <DispatchBoard />
    </MainPageContent>
  )
}
