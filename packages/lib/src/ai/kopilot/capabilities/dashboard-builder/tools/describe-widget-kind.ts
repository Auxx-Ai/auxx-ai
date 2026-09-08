// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/describe-widget-kind.ts

import { WIDGET_KINDS, type WidgetKind } from '../../../../../dashboards/client'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveDashboardAuthoring } from './dashboard-authoring-guard'
import { dashboardToolPermission } from './dashboard-tool-helpers'
import { describeWidgetKind } from './widget-kind-schema'

/**
 * One widget kind in full: the friendly config keys it accepts, its
 * display-only `options`, what the publish schema will not accept it without,
 * what it is still missing before it renders, and a worked example.
 *
 * Every part of that is PROJECTED from `config-schemas.ts` and the same
 * `widgetIssues` guard `validate_dashboard` runs, so nothing here can drift
 * from what a write will actually accept.
 */
export function createDescribeWidgetKindTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'describe_widget_kind',
    permission: dashboardToolPermission('view'),
    displayName: 'Describe widget kind',
    surfaces: ['builder'],
    idempotent: true,
    description:
      'Get one widget kind in detail: the config keys it takes (all NAMES, never ids), its display-only options, what it needs before the dashboard can be published, what it needs before it renders anything, and a worked example. Call this before add_widget.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [...WIDGET_KINDS],
          description: 'Widget kind from list_widget_kinds.',
        },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    summary: (args) => `Describe widget: ${typeof args.kind === 'string' ? args.kind : 'kind'}`,
    buildDigest: (output) => {
      const out = (output ?? {}) as { kind?: unknown }
      return { label: typeof out.kind === 'string' ? `Described ${out.kind}` : 'Widget kind read' }
    },
    execute: async (args, agentDeps) => {
      const auth = await resolveDashboardAuthoring(getDeps, agentDeps, 'view')
      if (!auth.ok) return { success: false, output: null, error: auth.error }

      const kind = typeof args.kind === 'string' ? (args.kind as WidgetKind) : undefined
      const described = kind ? describeWidgetKind(kind) : undefined
      if (!described) {
        return {
          success: false,
          output: null,
          error: `Unknown widget kind "${String(args.kind)}". Available: ${WIDGET_KINDS.join(', ')}.`,
        }
      }
      return { success: true, output: described }
    },
  }
}
