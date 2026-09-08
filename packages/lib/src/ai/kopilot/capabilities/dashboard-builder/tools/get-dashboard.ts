// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/get-dashboard.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveDashboardAuthoring } from './dashboard-authoring-guard'
import { dashboardToolPermission } from './dashboard-tool-helpers'

/**
 * The whole draft, compact: name, tabs, one line of config per widget, whether
 * each widget is configured, the global filter DEFAULTS, current issues, and
 * whether the draft has diverged from what is published.
 *
 * Config BODIES are deliberately omitted; `get_widget` fetches those. A
 * three-tab dashboard with twenty configured widgets is a large document and
 * re-emitting it per tool result burns the turn budget for nothing.
 */
export function createGetDashboardTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_dashboard',
    permission: dashboardToolPermission('view'),
    displayName: 'Get dashboard',
    surfaces: ['builder'],
    idempotent: true,
    description:
      "Read the open dashboard draft: name, tabs, every widget (title, kind, one-line config summary, whether it is configured), the dashboard's default global filters, current issues, and whether the draft differs from the published version. Use get_widget for one widget's full configuration.",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    buildDigest: (output) => {
      const out = (output ?? {}) as { widgets?: unknown[] }
      return {
        label: 'Dashboard loaded',
        widgetCount: Array.isArray(out.widgets) ? out.widgets.length : 0,
      }
    },
    execute: async (_args, agentDeps) => {
      const auth = await resolveDashboardAuthoring(getDeps, agentDeps, 'view')
      if (!auth.ok) return { success: false, output: null, error: auth.error }

      const { db } = getDeps()
      // Lazy import - the draft-edit barrel reaches drizzle, Redis and the org
      // cache; keeping it out of this capability's import-time graph is what
      // lets a test mock the module wholesale.
      const { buildLayoutSummary, buildWidgetSummary, loadDraftContext, validateDashboard } =
        await import('../../../../../dashboards/draft-edit')
      const loaded = await loadDraftContext(db, {
        dashboardId: auth.dashboardId,
        organizationId: agentDeps.organizationId,
      })
      if (loaded.isErr()) {
        return { success: false, output: null, error: loaded.error.message }
      }
      const { row, doc } = loaded.value
      const validation = validateDashboard(doc)

      return {
        success: true,
        output: {
          name: row.name,
          description: row.description ?? null,
          hasUnpublishedChanges: row.hasUnpublishedChanges,
          layoutSummary: buildLayoutSummary(doc),
          tabs: doc.tabs.map((tab) => ({
            tab: tab.title,
            widgets: tab.widgets.map((widget) => buildWidgetSummary(doc, widget, tab)),
          })),
          globalFilterDefaults: doc.globalFilters ?? null,
          publishable: validation.publishable,
          issues: validation.issues,
        },
      }
    },
  }
}
