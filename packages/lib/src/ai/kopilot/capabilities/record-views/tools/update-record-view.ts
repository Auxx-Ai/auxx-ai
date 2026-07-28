// packages/lib/src/ai/kopilot/capabilities/record-views/tools/update-record-view.ts

import { onCacheEvent } from '../../../../../cache/invalidate'
import { updateTableView } from '../../../../../table-views'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { buildViewConfigPatch, type ViewSpec } from '../build-view-config'
import { resolveRecordViewTarget } from '../target'
import { RECORD_VIEW_UPDATE_PARAMS, readViewSpec } from './params'

/**
 * Edit an existing saved view on the records table the user is on — filters,
 * sort, columns, and/or name. Only the parts the user named change: the spec is
 * built into a config **patch** (`buildViewConfigPatch`) that the lib
 * `updateTableView` shallow-merges over the stored config, preserving UI-set
 * column sizing/pinning/formatting. Returns a `_kopilotRecordView` side-channel
 * (`kind: 'updated'`) so the frontend reconciles and switches to the view.
 */
export function createUpdateRecordViewTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'update_table_view',
    permission: {
      target: 'definition',
      level: 'view',
      enforcement: 'enforced',
      note: 'canViewEntity on the page’s def, matching the human router.',
    },
    displayName: 'Update table view',
    category: 'capability',
    description: `Edit an existing saved view on the records table the user is currently viewing — change its filters, sort, columns, and/or name. Only what you pass changes; everything else (column widths, formatting, other settings) is kept. Get the viewId from list_table_views first. Filters use the same grammar as query_records.

Example: { viewId: "abc123", filters: [{ field: "status", operator: "is", value: "OPEN" }] } replaces just the filters and leaves sort + columns alone.`,
    usageNotes:
      'Pass only what should change. An explicit empty `filters: []` clears all filters. Inspect `warnings[]` for any dropped filters/columns. Renaming onto an existing name returns an error — pick another.',
    parameters: RECORD_VIEW_UPDATE_PARAMS,
    execute: async (args, agentDeps) => {
      const viewId = typeof args.viewId === 'string' ? args.viewId : ''
      if (!viewId) {
        return {
          success: false,
          output: null,
          error: 'A viewId is required — call list_table_views to find it.',
        }
      }

      const name = typeof args.name === 'string' ? args.name.trim() : undefined
      if (name !== undefined && name.length > 50) {
        return { success: false, output: null, error: 'View name must be 50 characters or fewer.' }
      }

      const { db, sessionContext, capabilities } = getDeps()
      const target = await resolveRecordViewTarget(sessionContext, agentDeps.organizationId)
      if ('error' in target) {
        return { success: false, output: null, error: target.error }
      }
      const { resource, entityDefinitionId, tableId } = target

      // Human parity (permissions v2 §3.3): the tRPC path gates view authoring on
      // effective Read of the def (`tableView.update` → `assertViewAccess`), so the
      // agent path must too. Absent capabilities ⇒ unrestricted, as before.
      if (entityDefinitionId && capabilities && !capabilities.canViewEntity(entityDefinitionId)) {
        return {
          success: false,
          output: null,
          error: "You don't have permission to view these records.",
        }
      }

      const spec: ViewSpec = readViewSpec(args)
      const built = buildViewConfigPatch(spec, resource, entityDefinitionId)

      // Don't let an all-invalid filter set silently WIPE the view's existing
      // filters. `filters: []` only clears when the model intentionally passed an
      // empty array — not when every filter it passed was dropped as invalid.
      const requestedFilterCount = Array.isArray(spec.filters) ? spec.filters.length : 0
      const filtersAllDropped = requestedFilterCount > 0 && (built.patch.filters?.length ?? 0) === 0
      if (filtersAllDropped) delete built.patch.filters

      const hasConfigChange = Object.keys(built.patch).length > 0

      if (name === undefined && !hasConfigChange) {
        const warnHint =
          built.warnings.length > 0
            ? ` The filter(s) you passed were invalid: ${built.warnings.map((w) => w.hint).join(' ')}`
            : ' Pass new filters, a sort, columns, or a name.'
        return {
          success: false,
          output: built.warnings.length > 0 ? { warnings: built.warnings } : null,
          error: `Nothing was updated.${warnHint}`,
        }
      }

      const result = await updateTableView({
        db,
        id: viewId,
        userId: agentDeps.userId,
        organizationId: agentDeps.organizationId,
        expectedTableId: tableId,
        name,
        configPatch: hasConfigChange ? built.patch : undefined,
      })

      if (!result.ok) {
        const error =
          result.reason === 'duplicate_name'
            ? `A view named "${name}" already exists on this table — pick a different name.`
            : result.reason === 'table_mismatch'
              ? 'That view belongs to a different table. List the views on this table and pick one of those.'
              : "That view doesn't exist or you can't edit it. Call list_table_views to see the editable ones."
        return { success: false, output: null, error }
      }

      // Keep the per-user view cache (and tableView.listAll) in sync.
      await onCacheEvent('table-view.updated', {
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
        kind: 'updated',
      })

      return {
        success: true,
        output: {
          summary: `Updated the "${result.view.name}" view on ${resource.plural}.`,
          viewId: result.view.id,
          appliedFilters: built.appliedFilterCount,
          warnings: built.warnings.length > 0 ? built.warnings : undefined,
          // Per-session UI directive only (switch to + re-seed the edited view
          // instantly). Cross-client data refresh rides the realtime event above.
          _kopilotRecordView: {
            kind: 'updated' as const,
            tableId,
            view: result.view,
          },
        },
      }
    },
  }
}
