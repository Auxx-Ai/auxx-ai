// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/list-dashboard-sources.ts

import { getCachedResources } from '../../../../../cache'
// The LEAF, never the `resources/aggregate` barrel: the barrel's index pulls
// `run-aggregate.ts`, which constructs a `PromiseMemoizer` from the org cache at
// module scope. That would put the whole aggregate engine in this capability's
// import-time graph, and every sibling capability's test that partially mocks
// `../cache` would fail to collect.
import { SYSTEM_AGGREGATE_TABLE_IDS } from '../../../../../resources/aggregate/system-aggregate-builder'
import { isMailLensTableId } from '../../../../../resources/picker/mail-lens-tables'
import type { Resource } from '../../../../../resources/registry/types'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveDashboardAuthoring } from './dashboard-authoring-guard'
import { dashboardToolPermission } from './dashboard-tool-helpers'

/** What the model picks a source by. `name` is what every write accepts. */
interface SourceSummary {
  /** Pass this verbatim as a widget's `source`. */
  name: string
  label: string
  plural: string
}

/**
 * Server-side source list, composed from the REAL allowlists: the org's
 * resources cache plus `SYSTEM_AGGREGATE_TABLE_IDS`. It must never reach for
 * the client-safe mirrors in `apps/web/src/components/dashboard/lib/`.
 *
 * **`thread` and `message` are excluded**, mirroring the refusal
 * `resolveWidgetSource` already raises: the system aggregate builder emits
 * `WHERE organizationId = $1` and nothing else, so a chart over `thread` counts
 * the entire org mailbox for anyone who can open the dashboard, and a
 * high-cardinality group-by prints subject lines as its labels. The mail-lens
 * gradation (metadata / identity / read) is per-viewer and not expressible in a
 * `WHERE` clause, which is why this is an exclusion rather than a filter.
 * Offering them would offer a source that can only ever 403.
 *
 * Entity defs are filtered through `capabilities.canViewEntity` so the list
 * does not leak the existence of defs the caller cannot read.
 *
 * FIELD DISCOVERY IS NOT HERE. `list_entity_fields`, `list_entities` and
 * `query_records` are already global tools; the prompt section points at them,
 * exactly as the record-views prompt does. A second field lister would be a
 * parallel surface to keep in sync for no gain.
 */
export function createListDashboardSourcesTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_dashboard_sources',
    permission: dashboardToolPermission('view'),
    displayName: 'List dashboard sources',
    surfaces: ['builder'],
    idempotent: true,
    description:
      "List the data sources a widget on this dashboard can read. Pass a `name` from here verbatim as a widget's `source`, then call list_entity_fields with that same name to get its fields. Mail (threads and messages) is not a dashboard source and is deliberately absent.",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    buildDigest: (output) => {
      const out = (output ?? {}) as { sources?: unknown[] }
      return {
        label: 'Dashboard sources listed',
        resultCount: Array.isArray(out.sources) ? out.sources.length : 0,
      }
    },
    execute: async (_args, agentDeps) => {
      const auth = await resolveDashboardAuthoring(getDeps, agentDeps, 'view')
      if (!auth.ok) return { success: false, output: null, error: auth.error }

      const { capabilities } = getDeps()
      const resources = await getCachedResources(agentDeps.organizationId)
      const byName = new Map<string, SourceSummary>()

      for (const resource of resources) {
        if (identifiesMailTable(resource)) continue
        // Fail closed on the def rung too: the guard already refused an absent
        // capability view, so a `false` here is a real denial.
        if (capabilities && !capabilities.canViewEntity(resource.entityDefinitionId)) continue
        byName.set(resource.apiSlug, {
          name: resource.apiSlug,
          label: resource.label,
          plural: resource.plural,
        })
      }

      // The curated aggregate tables. Added by id when the resources cache does
      // not already carry a row for one, so the two lists cannot disagree about
      // what is pickable.
      for (const tableId of SYSTEM_AGGREGATE_TABLE_IDS) {
        if (resources.some((resource) => resource.id === tableId)) continue
        byName.set(tableId, { name: tableId, label: tableId, plural: tableId })
      }

      return {
        success: true,
        output: {
          sources: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
          note: 'Call list_entity_fields with a source name to get its fields and the option value keys a filter needs. Mail threads and messages cannot be charted.',
        },
      }
    },
  }
}

/** Does this resource answer to a mail-lens table id under any of its names? */
function identifiesMailTable(resource: Resource): boolean {
  return [resource.id, resource.entityType, resource.apiSlug].some(
    (key) => typeof key === 'string' && isMailLensTableId(key)
  )
}
