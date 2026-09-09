// apps/web/src/app/(protected)/app/calls/layout.tsx

import type React from 'react'
import { CapabilityPageGuard } from '~/components/global/capability-page-guard'

type Props = { children: React.ReactNode }

/**
 * The calls surface's front door (task 12 §10 — recordings and meetings gained
 * their own area). Marker-style (no children): a denied member is redirected to
 * `/access-denied`, matching the mail layout's guard on `inboxes.view`.
 */
function layout({ children }: Props) {
  return (
    <>
      <CapabilityPageGuard permissionKey='calls.view' />
      {children}
    </>
  )
}

export default layout
