// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/change-widget-type.ts

import { WIDGET_KINDS, type WidgetKind } from '../../../../../dashboards/client'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { buildDashboardEditDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import {
  dashboardToolPermission,
  digestLabelFromOutput,
  mutationToToolResult,
} from './dashboard-tool-helpers'
import { optionalString, resolveDashboardWrite } from './write-tool-helpers'

/**
 * Convert a widget to another data-widget kind, carrying over every setting the
 * target kind also has.
 *
 * Reports `droppedFieldsOnConvert` so the model can warn the user BEFORE the
 * conversion loses a group-by rather than after. `richText` and `iframe` are
 * neither a valid source nor a valid target: they carry no data configuration
 * to convert.
 */
export function createChangeWidgetTypeTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'change_widget_type',
    permission: dashboardToolPermission('edit'),
    displayName: 'Change widget type',
    surfaces: ['builder'],
    description:
      'Turn one widget into a different kind (bar to line, KPI to gauge, and so on), keeping every setting the new kind also has. The result names anything the conversion dropped in `droppedFieldsOnConvert`. Notes and embeds cannot be converted either way.',
    parameters: {
      type: 'object',
      properties: {
        widget: { type: 'string', description: 'Widget title (a unique prefix works).' },
        toKind: {
          type: 'string',
          enum: [...WIDGET_KINDS],
          description: 'The kind to convert it to.',
        },
      },
      required: ['widget', 'toKind'],
      additionalProperties: false,
    },
    summary: (args) =>
      `Change widget type: ${typeof args.toKind === 'string' ? args.toKind : 'widget'}`,
    buildDigest: (output) =>
      buildDashboardEditDigest(digestLabelFromOutput(output, 'Changed widget type'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveDashboardWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }
      const widget = optionalString(args.widget)
      const kind = typeof args.toKind === 'string' ? (args.toKind as WidgetKind) : undefined
      if (!widget) return { success: false, output: null, error: 'widget is required.' }
      if (!kind || !WIDGET_KINDS.includes(kind)) {
        return {
          success: false,
          output: null,
          error: `toKind is required and must be one of: ${WIDGET_KINDS.join(', ')}.`,
        }
      }

      const { db } = getDeps()
      // Lazy import - see get-dashboard.ts.
      const { changeWidgetType } = await import('../../../../../dashboards/draft-edit')
      const result = await changeWidgetType(db, write.scope, { widget, kind })
      return mutationToToolResult(
        result,
        (value) =>
          value.applied
            ? `Changed ${value.widget?.ref ?? widget} to ${kind}`
            : `Convert ${widget} blocked`,
        (value) => ({ droppedFieldsOnConvert: value.droppedFieldsOnConvert })
      )
    },
  }
}
