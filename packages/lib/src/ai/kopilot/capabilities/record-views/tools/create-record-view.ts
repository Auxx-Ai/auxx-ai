// packages/lib/src/ai/kopilot/capabilities/record-views/tools/create-record-view.ts

import { onCacheEvent } from '../../../../../cache/invalidate'
import { createTableView } from '../../../../../table-views'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { buildViewConfig, type ViewSpec } from '../build-view-config'
import { resolveRecordViewTarget } from '../target'
import { RECORD_VIEW_CREATE_PARAMS, readViewSpec } from './params'

/**
 * Persist a named saved view (a `TableView` row) for the records table the user
 * is on, then signal the frontend to select it. Personal view only in v1 (not
 * shared / not default — those stay in the UI).
 */
export function createCreateRecordViewTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'create_table_view',
    displayName: 'Save table view',
    category: 'capability',
    description: `Save a named view (filters + sort + columns) on the records table the user is currently viewing, and switch to it. The view persists and appears as a tab. The entity/table is taken from the page — you do not choose it. Filters use the same grammar as query_records; call list_entity_fields first for field ids and option values.

Example: { name: "Open tickets", filters: [{ field: "status", operator: "is", value: "OPEN" }], sort: { field: "createdAt", direction: "desc" } }`,
    usageNotes:
      'If the name already exists this returns an error — pick a different name. Inspect `warnings[]` for any dropped filters/columns. Preview first with preview_table_view if the user wants to see results before saving.',
    parameters: RECORD_VIEW_CREATE_PARAMS,
    execute: async (args, agentDeps) => {
      const name = typeof args.name === 'string' ? args.name.trim() : ''
      if (!name) {
        return { success: false, output: null, error: 'A view name is required.' }
      }
      if (name.length > 50) {
        return { success: false, output: null, error: 'View name must be 50 characters or fewer.' }
      }

      const { db, sessionContext, capabilities } = getDeps()
      const target = await resolveRecordViewTarget(sessionContext, agentDeps.organizationId)
      if ('error' in target) {
        return { success: false, output: null, error: target.error }
      }
      const { resource, entityDefinitionId, tableId } = target

      // Human parity (permissions v2 §3.3): the tRPC path gates view authoring on
      // effective Read of the def (`tableView.create` → `assertViewAccess`), so the
      // agent path must too — otherwise an agent restricted off a def could still
      // author views on it. Absent capabilities ⇒ unrestricted, as before.
      if (entityDefinitionId && capabilities && !capabilities.canViewEntity(entityDefinitionId)) {
        return {
          success: false,
          output: null,
          error: "You don't have permission to view these records.",
        }
      }

      const spec: ViewSpec = readViewSpec(args)
      const built = buildViewConfig(spec, resource, entityDefinitionId)

      const result = await createTableView({
        db,
        tableId,
        name,
        config: built.config as unknown as Record<string, unknown>,
        userId: agentDeps.userId,
        organizationId: agentDeps.organizationId,
      })

      if (!result.ok) {
        return {
          success: false,
          output: null,
          error: `A view named "${name}" already exists on this table — pick a different name.`,
        }
      }

      // Keep the per-user view cache (and tableView.listAll) in sync.
      await onCacheEvent('table-view.created', {
        orgId: agentDeps.organizationId,
        userId: agentDeps.userId,
      })

      // Realtime: re-list the table's views on every records page in the org
      // (lazy import — realtime → cache → capabilities would be a static cycle).
      const { getRealtimeService, publishTableViewChanged } = await import(
        '../../../../../realtime'
      )
      await publishTableViewChanged(getRealtimeService(), agentDeps.organizationId, {
        tableId,
        kind: 'created',
      })

      return {
        success: true,
        output: {
          summary: `Created and opened the "${name}" view on ${resource.plural}.`,
          viewId: result.view.id,
          appliedFilters: built.appliedFilterCount,
          warnings: built.warnings.length > 0 ? built.warnings : undefined,
          _kopilotRecordView: {
            kind: 'created' as const,
            tableId,
            view: result.view,
          },
        },
      }
    },
  }
}
