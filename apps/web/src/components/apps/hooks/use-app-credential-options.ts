// apps/web/src/components/apps/hooks/use-app-credential-options.ts
'use client'

import { useMemo } from 'react'
import { useUser } from '~/hooks/use-user'
import { type AppConnection, useExtensionsContext } from '~/providers/extensions/extensions-context'

export interface AppCredentialOptions {
  /** Org-singleton (workspace) credentials for this app. */
  workspace: AppConnection[]
  /** Personal credentials owned by the current user for this app. */
  personal: AppConnection[]
  /** Other teammates' personal credentials — informational only; never selectable. */
  otherPersonal: AppConnection[]
}

/**
 * List the bind-able connections for one app, split by scope. Used by
 * `AppAccountPicker` and friends. Filters `appConnections` from the
 * extensions context — same source the rest of the UI uses, so we never
 * fall out of sync. See plans/kopilot/apps/agent-credentials.md §3.4.
 */
export function useAppCredentialOptions(appId: string | undefined | null): AppCredentialOptions {
  const { appConnections } = useExtensionsContext()
  const { userId: currentUserId } = useUser()

  return useMemo(() => {
    if (!appId) return { workspace: [], personal: [], otherPersonal: [] }
    const forApp = appConnections.filter((c) => c.appId === appId)
    const workspace: AppConnection[] = []
    const personal: AppConnection[] = []
    const otherPersonal: AppConnection[] = []
    for (const row of forApp) {
      if (row.global) workspace.push(row)
      else if (row.userId && row.userId === currentUserId) personal.push(row)
      else otherPersonal.push(row)
    }
    return { workspace, personal, otherPersonal }
  }, [appId, appConnections, currentUserId])
}
