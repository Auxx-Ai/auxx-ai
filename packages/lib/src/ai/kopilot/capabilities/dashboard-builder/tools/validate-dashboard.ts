// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/validate-dashboard.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveDashboardAuthoring } from './dashboard-authoring-guard'
import { dashboardToolPermission } from './dashboard-tool-helpers'

/**
 * The publish gate without the publish.
 *
 * IT REPORTS TWO DIFFERENT THINGS, and conflating them is the failure this tool
 * exists to avoid. `validateDashboard` returns error-severity issues that do NOT
 * block publishing: `dashboardLayoutDocSchema` has `url: z.string().url().nullable()`
 * and `columns: z.array(...)` with no `.min(1)`, so an embed with no URL and a
 * record list with no columns are both "error" by the render guards and both
 * perfectly publishable. A caller that counts errors to answer "can I publish"
 * gets the wrong answer and refuses to finish work that was already finishable.
 *
 * So `publishable` is reported on its own - it is
 * `dashboardLayoutDocSchema.safeParse(doc).success` and nothing else, the exact
 * answer `publishDashboard` will give - and the issues are split into
 * `blocksPublish` and `willRenderEmpty`. The schema is not changed to make the
 * two agree; they are genuinely different questions.
 */
export function createValidateDashboardTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'validate_dashboard',
    permission: dashboardToolPermission('view'),
    displayName: 'Validate dashboard',
    surfaces: ['builder'],
    idempotent: true,
    description:
      'Run the publish gate on the open dashboard draft WITHOUT publishing. `publishable` is the real answer to "can the user publish this". `blocksPublish` lists what would stop them; `willRenderEmpty` lists widgets that publish fine but show nothing until they are finished. Call this once, after your edits have come back applied.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    buildDigest: (output) => {
      const out = (output ?? {}) as { publishable?: unknown; blocksPublish?: unknown[] }
      return {
        label: out.publishable === true ? 'Dashboard is publishable' : 'Dashboard has problems',
        ...(typeof out.publishable === 'boolean' ? { publishable: out.publishable } : {}),
        ...(Array.isArray(out.blocksPublish) ? { issueCount: out.blocksPublish.length } : {}),
      }
    },
    execute: async (_args, agentDeps) => {
      const auth = await resolveDashboardAuthoring(getDeps, agentDeps, 'view')
      if (!auth.ok) return { success: false, output: null, error: auth.error }

      const { db } = getDeps()
      // Lazy import - see get-dashboard.ts.
      const { formatWidgetRef, loadDraftContext, validateDashboard, widgetIssues } = await import(
        '../../../../../dashboards/draft-edit'
      )
      const loaded = await loadDraftContext(db, {
        dashboardId: auth.dashboardId,
        organizationId: agentDeps.organizationId,
      })
      if (loaded.isErr()) return { success: false, output: null, error: loaded.error.message }

      const doc = loaded.value.doc
      const { issues, publishable } = validateDashboard(doc)

      // Split the two sources `validateDashboard` merges, by re-running the
      // render guard rather than pattern-matching its prose: whatever
      // `widgetIssues` produced is a RENDER problem, and whatever is left when
      // the doc does not parse is what the publish SCHEMA rejected. Deriving it
      // this way means the split cannot drift from either function.
      const renderMessages = new Set<string>()
      for (const tab of doc.tabs) {
        for (const widget of tab.widgets) {
          for (const issue of widgetIssues(widget, formatWidgetRef(doc, widget.id))) {
            renderMessages.add(issue.message)
          }
        }
      }
      const blocksPublish = publishable
        ? []
        : issues.filter((issue) => issue.severity === 'error' && !renderMessages.has(issue.message))
      const willRenderEmpty = issues.filter(
        (issue) => issue.severity === 'error' && renderMessages.has(issue.message)
      )
      const warnings = issues.filter((issue) => issue.severity === 'warning')

      return {
        success: true,
        output: {
          publishable,
          blocksPublish,
          willRenderEmpty,
          warnings,
          note: publishable
            ? "This dashboard can be published as it stands. Anything under willRenderEmpty is a widget that will show nothing until it is finished - report it, but do not treat it as a blocker. Publishing is the user's action, in the editor."
            : 'This dashboard cannot be published yet. Fix everything under blocksPublish.',
        },
      }
    },
  }
}
