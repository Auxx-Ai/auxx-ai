// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/add-widget.ts

import { WIDGET_KINDS, type WidgetKind } from '../../../../../dashboards/client'
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
 * Add one widget to the open dashboard's draft. A thin wrapper over draft-edit
 * `addWidget`: placement, id, default configuration, title de-duplication and
 * every name-to-ref resolution live there.
 *
 * NO COORDINATES. Placement is automatic and `arrange_widgets` is the one tool
 * that takes grid cells.
 */
export function createAddWidgetTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'add_widget',
    permission: dashboardToolPermission('edit'),
    displayName: 'Add widget',
    surfaces: ['builder'],
    description:
      'Add one widget to the open dashboard draft. Give it a `kind`, a `title`, a `source` NAME and whatever config that kind needs (call describe_widget_kind first). Do not send coordinates - placement is automatic. The result returns the widget, the layout summary and any issues.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [...WIDGET_KINDS],
          description: 'Widget kind from list_widget_kinds.',
        },
        title: {
          type: 'string',
          description: 'Widget title. This is how you address it afterwards, so make it distinct.',
        },
        tab: { type: 'string', description: 'Tab title to add it to. Defaults to the first tab.' },
        ...WIDGET_CONFIG_PROPERTIES,
      },
      required: ['kind'],
      additionalProperties: false,
    },
    summary: (args) => `Add widget: ${typeof args.kind === 'string' ? args.kind : 'widget'}`,
    buildDigest: (output) =>
      buildDashboardEditDigest(digestLabelFromOutput(output, 'Added widget'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveDashboardWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }
      const kind = typeof args.kind === 'string' ? (args.kind as WidgetKind) : undefined
      if (!kind || !WIDGET_KINDS.includes(kind)) {
        return {
          success: false,
          output: null,
          error: `kind is required and must be one of: ${WIDGET_KINDS.join(', ')}.`,
        }
      }

      const { db } = getDeps()
      // Lazy import - see get-dashboard.ts.
      const { addWidget } = await import('../../../../../dashboards/draft-edit')
      const result = await addWidget(db, write.scope, {
        kind,
        ...(optionalString(args.title) ? { title: optionalString(args.title) as string } : {}),
        ...(optionalString(args.tab) ? { tab: optionalString(args.tab) as string } : {}),
        ...parseWidgetConfigArgs(args),
      })
      return mutationToToolResult(result, (value) =>
        value.applied ? `Added ${value.widget?.ref ?? kind}` : `Add ${kind} blocked`
      )
    },
  }
}
