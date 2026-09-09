// apps/web/src/app/(protected)/app/kopilot/layout.tsx

import type React from 'react'
import { CapabilityPageGuard } from '~/components/global/capability-page-guard'

type Props = { children: React.ReactNode }

/**
 * The kopilot chat surface's front door. `agents.view` is the Read rung on
 * agents — its registry note reads "see the agent and USE it, chat in
 * Kopilot" — so every nested route (`new`, `[sessionId]`) inherits this guard.
 * Marker-style (no children): a denied member is redirected to `/access-denied`,
 * matching the mail layout's guard on `inboxes.view`.
 */
async function KopilotLayout({ children }: Props) {
  return (
    <>
      <CapabilityPageGuard permissionKey='agents.view' />
      {children}
    </>
  )
}

export default KopilotLayout
