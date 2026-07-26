// packages/lib/src/ai/kopilot/capabilities/record-views/tools/list-table-views.ts

import { getUserCache } from '../../../../../cache/singletons'
import type { CachedTableView } from '../../../../../cache/user-cache-keys'
import type { Resource } from '../../../../../resources/registry/types'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { fieldColumnId } from '../build-view-config'
import { resolveRecordViewTarget } from '../target'

interface ViewSummary {
  id: string
  name: string
  isDefault: boolean
  isShared: boolean
  viewType: 'table' | 'kanban' | 'calendar'
  filterCount: number
  sort?: { field: string; direction: 'asc' | 'desc' }
}

/** Map a cached view to a lean, model-readable summary (sort id resolved to a field name). */
function summarizeView(
  view: CachedTableView,
  resource: Resource,
  entityDefinitionId: string
): ViewSummary {
  const config = (view.config ?? {}) as {
    filters?: Array<{ conditions?: unknown[] }>
    sorting?: Array<{ id: string; desc: boolean }>
    viewType?: 'table' | 'kanban' | 'calendar'
  }

  const filterCount = (config.filters ?? []).reduce(
    (n, group) => n + (group?.conditions?.length ?? 0),
    0
  )

  let sort: ViewSummary['sort']
  const firstSort = config.sorting?.[0]
  if (firstSort) {
    const field = resource.fields.find((f) => fieldColumnId(f, entityDefinitionId) === firstSort.id)
    sort = {
      field: field?.key ?? field?.systemAttribute ?? firstSort.id,
      direction: firstSort.desc ? 'desc' : 'asc',
    }
  }

  return {
    id: view.id,
    name: view.name,
    isDefault: view.isDefault,
    isShared: view.isShared,
    viewType: config.viewType ?? 'table',
    filterCount,
    ...(sort ? { sort } : {}),
  }
}

/**
 * List the saved views on the records table the user is currently viewing.
 * Read-only (served from the per-user view cache) — the model calls this to
 * answer "what views do I have?" and to get a `viewId` for `update_table_view`
 * / `set_default_table_view`.
 */
export function createListTableViewsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_table_views',
    permission: {
      target: 'definition',
      level: 'read',
      enforcement: 'enforced',
      note: 'canViewEntity on the page’s def, matching its create/update/preview siblings (19b G7). Views are named, filtered projections OF the def, so listing them needs the same Read rung as reading it.',
    },
    displayName: 'List table views',
    category: 'capability',
    idempotent: true,
    description: `List the saved views on the records table the user is currently viewing — names, which one is the default, whether it's shared, and a short filter/sort summary. Call this BEFORE update_table_view or set_default_table_view to get the viewId to act on. The table is taken from the page; you do not pass it.`,
    usageNotes:
      'Each entry has `id` (use as viewId), `name`, `isDefault`, `isShared`, `filterCount`, and an optional `sort`. An empty list means the user has no saved views on this table yet.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_args, agentDeps) => {
      const { sessionContext, capabilities } = getDeps()
      const target = await resolveRecordViewTarget(sessionContext, agentDeps.organizationId)
      if ('error' in target) {
        return { success: false, output: null, error: target.error }
      }
      const { resource, entityDefinitionId, tableId } = target

      // Human parity (permissions v2 §3.3), identical to the create/update/preview
      // siblings: a saved view is a named projection OF the def — its name, filter
      // count and sort field describe the def's data and schema. An agent published
      // `None` on the def must not learn them. Absent capabilities ⇒ unrestricted, as before.
      if (entityDefinitionId && capabilities && !capabilities.canViewEntity(entityDefinitionId)) {
        return {
          success: false,
          output: null,
          error: "You don't have permission to view these records.",
        }
      }

      const all = (await getUserCache().get(
        agentDeps.userId,
        'userTableViews',
        agentDeps.organizationId
      )) as CachedTableView[] | null

      const views = (all ?? [])
        .filter((v) => v.tableId === tableId && v.contextType === 'table')
        .map((v) => summarizeView(v, resource, entityDefinitionId))

      return {
        success: true,
        output: {
          summary:
            views.length > 0
              ? `${views.length} saved view${views.length === 1 ? '' : 's'} on ${resource.plural}.`
              : `No saved views on ${resource.plural} yet.`,
          views,
        },
      }
    },
  }
}
