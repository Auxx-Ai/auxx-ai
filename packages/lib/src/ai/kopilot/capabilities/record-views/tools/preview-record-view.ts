// packages/lib/src/ai/kopilot/capabilities/record-views/tools/preview-record-view.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { buildViewConfig, type ViewSpec } from '../build-view-config'
import { countRecordMatches } from '../count-matches'
import { resolveRecordViewTarget } from '../target'
import { RECORD_VIEW_PARAMS, readViewSpec } from './params'

/**
 * Live-apply a filter/sort/column config to the records table the user is
 * currently looking at — a transient preview, nothing is persisted. The result
 * carries a `_kopilotRecordView` side-channel the frontend applies to the
 * dynamic-table store.
 */
export function createPreviewRecordViewTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'preview_table_view',
    displayName: 'Preview table view',
    category: 'capability',
    description: `Live-preview a filtered/sorted/column view on the records table the user is currently viewing. Applies instantly to the on-screen table WITHOUT saving. Use this to show the user a result before they commit; follow with create_table_view to save it.

The entity/table is taken from the page the user is on — you do not choose it. Use list_entity_fields to discover field ids and valid option values. Filters use the same grammar as query_records.

Examples:
- Open tickets, newest first: { filters: [{ field: "status", operator: "is", value: "OPEN" }], sort: { field: "createdAt", direction: "desc" } }
- Show only name + email columns: { columns: ["contact_name", "contact_email"] }`,
    usageNotes:
      'Inspect `warnings[]` — each means a filter/sort/column was dropped. Preview is unsaved; the user can clear it from the search bar. To persist, call create_table_view with the same args plus a name.',
    parameters: RECORD_VIEW_PARAMS,
    execute: async (args, agentDeps) => {
      const { db, sessionContext } = getDeps()
      const target = await resolveRecordViewTarget(sessionContext, agentDeps.organizationId)
      if ('error' in target) {
        return { success: false, output: null, error: target.error }
      }
      const { resource, entityDefinitionId, tableId } = target

      const spec: ViewSpec = readViewSpec(args)
      const built = buildViewConfig(spec, resource, entityDefinitionId)

      let matched: number | undefined
      try {
        matched = await countRecordMatches({
          db,
          organizationId: agentDeps.organizationId,
          resource,
          entityDefinitionId,
          filters: built.validFilters,
          logicalOperator: built.logicalOperator,
        })
      } catch {
        matched = undefined
      }

      const hasColumns = (spec.columns?.length ?? 0) > 0
      const filterPart =
        built.appliedFilterCount > 0
          ? ` with ${built.appliedFilterCount} filter${built.appliedFilterCount === 1 ? '' : 's'}`
          : ''
      const matchPart =
        matched != null ? ` — ${matched} matching record${matched === 1 ? '' : 's'}` : ''

      return {
        success: true,
        output: {
          summary: `Previewing ${resource.plural}${filterPart}${matchPart}.`,
          matched,
          appliedFilters: built.appliedFilterCount,
          warnings: built.warnings.length > 0 ? built.warnings : undefined,
          _kopilotRecordView: {
            kind: 'preview' as const,
            tableId,
            filters: built.config.filters,
            sorting: built.config.sorting,
            ...(hasColumns
              ? {
                  columnVisibility: built.config.columnVisibility,
                  columnOrder: built.config.columnOrder,
                }
              : {}),
          },
        },
      }
    },
  }
}
