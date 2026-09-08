// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/update-widget.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { buildDashboardEditDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import {
  dashboardToolPermission,
  digestLabelFromOutput,
  mutationToToolResult,
} from './dashboard-tool-helpers'
import {
  optionalString,
  parseWidgetConfigArgs,
  resolveDashboardWrite,
  WIDGET_CONFIG_PROPERTIES,
} from './write-tool-helpers'

/**
 * Update one widget. The configuration SHALLOW-MERGES over what the widget
 * already holds, so a group-by can be set without restating the metric, and
 * `null` on an optional key clears it.
 *
 * A widget's KIND is not settable here - that is `change_widget_type`'s job,
 * because converting carries rules (which config survives, the span clamp, the
 * retitle-if-default) a merge would silently skip.
 */
export function createUpdateWidgetTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'update_widget',
    permission: dashboardToolPermission('edit'),
    displayName: 'Update widget',
    surfaces: ['builder'],
    description:
      'Edit one widget on the open dashboard draft, addressed by title. Only the keys you pass change; pass null on an optional key to clear it. Use change_widget_type to turn it into a different kind of widget.',
    parameters: {
      type: 'object',
      properties: {
        widget: { type: 'string', description: 'Widget title (a unique prefix works).' },
        title: { type: 'string', description: 'New title.' },
        ...WIDGET_CONFIG_PROPERTIES,
      },
      required: ['widget'],
      additionalProperties: false,
    },
    summary: (args) => `Update widget: ${typeof args.widget === 'string' ? args.widget : 'widget'}`,
    buildDigest: (output) =>
      buildDashboardEditDigest(digestLabelFromOutput(output, 'Updated widget'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveDashboardWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }
      const widget = optionalString(args.widget)
      if (!widget) return { success: false, output: null, error: 'widget is required.' }

      const { db } = getDeps()
      // Lazy import - see get-dashboard.ts.
      const { updateWidget } = await import('../../../../../dashboards/draft-edit')
      const result = await updateWidget(db, write.scope, {
        widget,
        ...(args.title !== undefined && typeof args.title === 'string'
          ? { title: args.title }
          : {}),
        ...parseWidgetConfigArgs(args),
      })
      return mutationToToolResult(result, (value) =>
        value.applied ? `Updated ${value.widget?.ref ?? widget}` : `Update ${widget} blocked`
      )
    },
  }
}
