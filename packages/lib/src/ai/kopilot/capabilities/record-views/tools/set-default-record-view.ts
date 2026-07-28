// packages/lib/src/ai/kopilot/capabilities/record-views/tools/set-default-record-view.ts

import { onCacheEvent } from '../../../../../cache/invalidate'
import { isAdminOrOwner } from '../../../../../members/member-queries'
import { setDefaultTableView } from '../../../../../table-views'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveRecordViewTarget } from '../target'

/**
 * Make a saved view the org default for the records table the user is on. This
 * also shares the view org-wide, so it's **admin/owner only** and gated behind
 * `requiresApproval` (the human confirm). The default flag flips on every
 * client purely via the `tableView:changed` realtime event — no per-session
 * side-channel. Mirrors the admin-only `tableView.setDefault` tRPC procedure.
 */
export function createSetDefaultRecordViewTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'set_default_table_view',
    permission: {
      target: 'definition',
      level: 'view',
      enforcement: 'enforced',
      note: 'canViewEntity on the def whose org-wide default it flips, in ADDITION to the pre-existing isAdminOrOwner role check (kept — it mirrors the admin-only `tableView.setDefault` tRPC procedure, and it is what bounds the org-wide blast radius). Deliberately NOT declared `full`: `canAdministerDef` has zero agent-tool callers (19b G8), so claiming a Full rung here would assert a check nothing performs. The role gate is the authority half; `Read` is the capability half.',
    },
    displayName: 'Set default table view',
    category: 'capability',
    requiresApproval: true,
    description: `Make a saved view the DEFAULT for everyone in the organization on the records table the user is currently viewing. This also shares the view org-wide. Admins/owners only. Get the viewId from list_table_views first.

Example: { viewId: "abc123" }`,
    usageNotes:
      'Changes what every org member sees by default and makes the view shared. Only org admins/owners can do this, and it asks the user to confirm first.',
    parameters: {
      type: 'object',
      properties: {
        viewId: {
          type: 'string',
          description: 'Id of the view to make the default — get it from list_table_views.',
        },
      },
      required: ['viewId'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const viewId = typeof args.viewId === 'string' ? args.viewId : ''
      if (!viewId) {
        return {
          success: false,
          output: null,
          error: 'A viewId is required — call list_table_views to find it.',
        }
      }

      const { db, sessionContext, capabilities } = getDeps()

      const admin = await isAdminOrOwner(agentDeps.organizationId, agentDeps.userId, db)
      if (!admin) {
        return {
          success: false,
          output: null,
          error: 'Only organization admins can set the default view for everyone.',
        }
      }

      const target = await resolveRecordViewTarget(sessionContext, agentDeps.organizationId)
      if ('error' in target) {
        return { success: false, output: null, error: target.error }
      }
      const { resource, entityDefinitionId, tableId } = target

      // Human parity (permissions v2 §3.3), same block and same insertion point as
      // the create/update/preview/list siblings. The role check above is an
      // AUTHORITY check ("may you change what everyone sees?"); this is the
      // CAPABILITY check ("may you read this def at all?"). Both are required:
      // without this, a principal restricted off the def could still flip its
      // org-wide default. Absent capabilities ⇒ unrestricted, as before.
      if (entityDefinitionId && capabilities && !capabilities.canViewEntity(entityDefinitionId)) {
        return {
          success: false,
          output: null,
          error: "You don't have permission to view these records.",
        }
      }

      const result = await setDefaultTableView({
        db,
        tableId,
        viewId,
        organizationId: agentDeps.organizationId,
      })

      if (!result.ok) {
        const error =
          result.reason === 'table_mismatch'
            ? 'That view belongs to a different table. List the views on this table and pick one of those.'
            : "That view doesn't exist. Call list_table_views to see the available ones."
        return { success: false, output: null, error }
      }

      await onCacheEvent('table-view.default-changed', {
        orgId: agentDeps.organizationId,
        userId: agentDeps.userId,
      })

      // Pure data change (the default flag flips on every client) — no per-session
      // UI directive. The realtime event re-lists views everywhere, including the
      // author's own table. Lazy import avoids the realtime→cache→capabilities cycle.
      const { getRealtimeService, publishTableViewChanged } = await import(
        '../../../../../realtime'
      )
      await publishTableViewChanged(getRealtimeService(), agentDeps.organizationId, {
        tableId,
        kind: 'defaultChanged',
      })

      return {
        success: true,
        output: {
          summary: `Set "${result.view.name}" as the default view on ${resource.plural} for everyone.`,
          viewId: result.view.id,
        },
      }
    },
  }
}
