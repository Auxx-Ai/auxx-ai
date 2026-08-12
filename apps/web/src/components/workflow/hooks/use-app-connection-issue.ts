// apps/web/src/components/workflow/hooks/use-app-connection-issue.ts

import { useCallback } from 'react'
import { useAppConnectionResolver } from '~/components/apps/hooks/use-app-connection-state'

/** Shape shared by `useNodeValidationErrors` and `useChecklist`. */
export interface NodeIssue {
  field: string
  message: string
  type: 'warning' | 'error'
}

/**
 * App nodes carry `type: "<appId>:<blockId>"`. `data.appId` is only written back
 * once `AppWorkflowNode` has mounted and persisted it, so parse the type — the
 * checklist validates nodes that were never rendered.
 */
function resolveAppId(data: { type?: unknown; appId?: unknown }): string | undefined {
  if (typeof data.appId === 'string' && data.appId) return data.appId
  const type = data.type
  if (typeof type !== 'string' || !type.includes(':')) return undefined
  const parts = type.split(':')
  return parts.length === 2 ? parts[0] : undefined
}

/**
 * Returns a resolver that reports an app node's connection problem as a standard
 * validation issue, so it flows through the same path as every other node
 * problem: the `NodeValidationWarning` badge on the node, the workflow
 * checklist, and the publish gate in `WorkflowToolbar`.
 *
 * Severity is deliberately split:
 * - **error** for `missing` — no credential exists at all, so the run *will*
 *   fail in the executor. Blocks publish.
 * - **warning** for `expired` — a credential exists and the runtime resolver
 *   refreshes OAuth tokens lazily, so this often heals itself on the next run.
 *   Blocking publish on it would be wrong.
 */
export function useAppConnectionIssueResolver(): (data: any) => NodeIssue | null {
  const resolveConnection = useAppConnectionResolver()

  return useCallback(
    (data: any) => {
      if (!data) return null
      const appId = resolveAppId(data)
      if (!appId) return null

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
    [resolveConnection]
  )
}
