// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/replace-layout.ts

import { WIDGET_KINDS, type WidgetKind } from '../../../../../dashboards/client'
import type { ReplaceLayoutTab } from '../../../../../dashboards/draft-edit'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { buildDashboardEditDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import {
  dashboardToolPermission,
  digestLabelFromOutput,
  mutationToToolResult,
} from './dashboard-tool-helpers'
import {
  optionalRecord,
  optionalString,
  parseWidgetConfigArgs,
  resolveDashboardWrite,
  WIDGET_CONFIG_PROPERTIES,
} from './write-tool-helpers'

/** Read the tab specs off raw args. Widgets without a valid kind are dropped. */
function parseTabs(value: unknown): ReplaceLayoutTab[] {
  if (!Array.isArray(value)) return []
  const tabs: ReplaceLayoutTab[] = []
  for (const entry of value) {
    const record = optionalRecord(entry)
    if (!record) continue
    const widgets = Array.isArray(record.widgets) ? record.widgets : []
    tabs.push({
      ...(optionalString(record.title) ? { title: optionalString(record.title) as string } : {}),
      widgets: widgets
        .map((widget) => optionalRecord(widget))
        .filter((widget): widget is Record<string, unknown> => !!widget)
        .filter((widget) => WIDGET_KINDS.includes(widget.kind as WidgetKind))
        .map((widget) => ({
          kind: widget.kind as WidgetKind,
          ...(optionalString(widget.title)
            ? { title: optionalString(widget.title) as string }
            : {}),
          ...parseWidgetConfigArgs(widget),
        })),
    })
  }
  return tabs
}

/**
 * Build a whole dashboard in one call. GREENFIELD ONLY.
 *
 * Refused the moment the draft holds any authored content, and that rule is
 * what keeps a whole-document write safe: a caller asked to "add a KPI" that
 * re-emits the whole doc drops every widget it failed to represent, and a
 * truncated response reads as a deletion. The targeted tools cannot delete what
 * they do not mention, so the guard costs nothing and closes that hole.
 */
export function createReplaceLayoutTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'replace_layout',
    permission: dashboardToolPermission('edit'),
    displayName: 'Replace layout',
    surfaces: ['builder'],
    description:
      'Lay out a whole EMPTY dashboard in one call: tabs, each with its widgets. Refused once the dashboard holds any configured widget - use add_widget, update_widget, delete_widgets, add_tab and delete_tab to change one in place. No coordinates: placement is automatic.',
    parameters: {
      type: 'object',
      properties: {
        tabs: {
          type: 'array',
          description: 'Tabs to create, in order. At least one.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              widgets: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', enum: [...WIDGET_KINDS] },
                    title: { type: 'string' },
                    ...WIDGET_CONFIG_PROPERTIES,
                  },
                  required: ['kind'],
                },
              },
            },
          },
        },
      },
      required: ['tabs'],
      additionalProperties: false,
    },
    summary: () => 'Build dashboard layout',
    buildDigest: (output) =>
      buildDashboardEditDigest(digestLabelFromOutput(output, 'Built layout'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveDashboardWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }
      const tabs = parseTabs(args.tabs)
      if (tabs.length === 0) {
        return {
          success: false,
          output: null,
          error: 'tabs is required: describe at least one tab.',
        }
      }

      const { db } = getDeps()
      // Lazy import - see get-dashboard.ts.
      const { replaceLayout } = await import('../../../../../dashboards/draft-edit')
      const result = await replaceLayout(db, write.scope, { tabs })
      return mutationToToolResult(result, (value) =>
        value.applied
          ? `Built ${value.layoutSummary.tabCount} tab${value.layoutSummary.tabCount === 1 ? '' : 's'} with ${value.layoutSummary.widgetCount} widget${value.layoutSummary.widgetCount === 1 ? '' : 's'}`
          : 'Layout replacement blocked'
      )
    },
  }
}
