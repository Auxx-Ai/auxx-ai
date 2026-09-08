// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/delete-widgets.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { buildDashboardEditDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import {
  dashboardToolPermission,
  digestLabelFromOutput,
  mutationToToolResult,
} from './dashboard-tool-helpers'
import { optionalStringArray, resolveDashboardWrite } from './write-tool-helpers'

/**
 * Remove widgets from the draft, addressed by title.
 *
 * No approval gate: every edit in a turn is captured by the turn's pre-edit
 * snapshot, and that snapshot is what the Undo card offers when a turn stops
 * early. The result returns the removed summaries so a reply can name what went.
 */
export function createDeleteWidgetsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'delete_widgets',
    permission: dashboardToolPermission('edit'),
    displayName: 'Delete widgets',
    surfaces: ['builder'],
    description:
      'Remove one or more widgets from the open dashboard draft, by title. The result lists what was removed. Nothing is removed unless every title resolves.',
    parameters: {
      type: 'object',
      properties: {
        widgets: {
          type: 'array',
          description: 'Widget titles to remove.',
          items: { type: 'string' },
        },
      },
      required: ['widgets'],
      additionalProperties: false,
    },
    summary: (args) => {
      const widgets = optionalStringArray(args.widgets) ?? []
      return `Delete ${widgets.length || 'widget'} widget${widgets.length === 1 ? '' : 's'}`
    },
    buildDigest: (output) =>
      buildDashboardEditDigest(digestLabelFromOutput(output, 'Deleted widgets'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveDashboardWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }
      const widgets = optionalStringArray(args.widgets) ?? []
      if (widgets.length === 0) {
        return { success: false, output: null, error: 'widgets is required: name at least one.' }
      }

      const { db } = getDeps()
      // Lazy import - see get-dashboard.ts.
      const { deleteWidgets } = await import('../../../../../dashboards/draft-edit')
      const result = await deleteWidgets(db, write.scope, { widgets })
      return mutationToToolResult(result, (value) =>
        value.applied
          ? `Removed ${(value.widgets ?? []).map((widget) => widget.ref).join(', ') || 'widgets'}`
          : 'Delete blocked'
      )
    },
  }
}
