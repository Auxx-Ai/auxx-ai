// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/list-widget-kinds.ts

import { WIDGET_KINDS } from '../../../../../dashboards/client'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveDashboardAuthoring } from './dashboard-authoring-guard'
import { dashboardToolPermission } from './dashboard-tool-helpers'
import { listWidgetKinds } from './widget-kind-schema'

/**
 * The compact widget catalog. Progressive disclosure: eight kinds with eight
 * distinct config unions is too much to put in a system prompt and most turns
 * need one of them, so this is the only widget list in the prompt path and
 * `describe_widget_kind` carries the schemas.
 *
 * Projects `WIDGET_KINDS` and the config schemas rather than a table of its
 * own, so a ninth kind lists here with no Kopilot edit.
 */
export function createListWidgetKindsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_widget_kinds',
    permission: dashboardToolPermission('view'),
    displayName: 'List widget kinds',
    surfaces: ['builder'],
    idempotent: true,
    description:
      'List the widget kinds you can add to this dashboard: kind, label, a one-line description, and whether it reads a data source. Call describe_widget_kind before configuring one.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    buildDigest: (output) => {
      const out = (output ?? {}) as { kinds?: unknown[] }
      return {
        label: 'Widget kinds listed',
        resultCount: Array.isArray(out.kinds) ? out.kinds.length : 0,
      }
    },
    execute: async (_args, agentDeps) => {
      const auth = await resolveDashboardAuthoring(getDeps, agentDeps, 'view')
      if (!auth.ok) return { success: false, output: null, error: auth.error }
      return { success: true, output: { kinds: listWidgetKinds(WIDGET_KINDS) } }
    },
  }
}
