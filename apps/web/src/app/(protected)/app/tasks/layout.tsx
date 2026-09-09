// apps/web/src/app/(protected)/app/tasks/layout.tsx

import type React from 'react'
import { CapabilityPageGuard } from '~/components/global/capability-page-guard'

type Props = { children: React.ReactNode }

/**
 * The tasks surface's front door (task 12 §10 — tasks gained their own area;
 * the nav showed them on no key and the router was `protectedProcedure`).
 * Marker-style (no children): a denied member is redirected to `/access-denied`,
 * matching the mail layout's guard on `inboxes.view`.
 */
async function TasksLayout({ children }: Props) {
  return (
    <>
      <CapabilityPageGuard permissionKey='tasks.view' />
      {children}
    </>
  )
}

export default TasksLayout
