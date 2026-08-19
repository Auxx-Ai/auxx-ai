// apps/web/src/components/workflow/hooks/use-app-node-issue.ts

import { useCallback } from 'react'
import { useAppConnectionResolver } from '~/components/apps/hooks/use-app-connection-state'
import { useOptionalAppsContext } from '~/components/apps/providers/apps-context'
import { resolveAppNodeMeta } from '~/components/workflow/apps/app-node-meta'

/** Shape shared by `useNodeValidationErrors` and `useChecklist`. */
export interface NodeIssue {
  field: string
  message: string
  type: 'warning' | 'error'
}

/**
 * Returns a resolver that reports an app node's problem as a standard validation
 * issue, so it flows through the same path as every other node problem: the
 * `NodeValidationWarning` badge on the node, the workflow checklist, and the
 * publish gate in `WorkflowToolbar`.
 *
 * Two problems, both fatal at run time, both `error`:
 *
 * - **App not installed** — the node came in with a workflow template, or the
 *   app was uninstalled under it. Nothing can resolve a deployment for it, so
 *   the engine cannot execute the block at all. This must be checked FIRST and
 *   independently of the connection resolver: `deriveAppConnectionState` reads
 *   `requiresConnection` off the *installations* list, so an uninstalled app
 *   resolves `not_required` and would silently report no issue whatsoever.
 * - **No connection** (`missing`) — a credential does not exist, so the run
 *   *will* fail in the executor.
 *
 * `expired` stays a **warning**: a credential exists and the runtime resolver
 * refreshes OAuth tokens lazily, so it often heals itself on the next run.
 * Blocking publish on it would be wrong.
 */
export function useAppNodeIssueResolver(): (data: any) => NodeIssue | null {
  const resolveConnection = useAppConnectionResolver()
  const appsContext = useOptionalAppsContext()

  return useCallback(
    (data: any) => {
      if (!data) return null
      const { appId, appSlug } = resolveAppNodeMeta(data)
      if (!appId) return null

      // Outside an `AppsProvider`, or before installations land, nothing is
      // knowable — never accuse an installed app of being missing on a cold
      // load, which would flash a publish-blocking error on every open.
      if (!appsContext || appsContext.isLoading) return null

      const isInstalled = appsContext.appInstallations.some((inst) => inst.app.id === appId)
      if (!isInstalled) {
        return {
          field: '_installation',
          message: appSlug
            ? `The ${appSlug} app is not installed — install it to run this step`
            : 'This step comes from an app that is not installed',
          type: 'error',
        }
      }

      const { state } = resolveConnection(appId, data.connectionId)
      if (state === 'missing') {
        return {
          field: '_connection',
          message: 'No connection — connect an account in App Settings',
          type: 'error',
        }
      }
      if (state === 'expired') {
        return {
          field: '_connection',
          message: 'Connection expired — reconnect the account in App Settings',
          type: 'warning',
        }
      }
      return null
    },
    [resolveConnection, appsContext]
  )
}
