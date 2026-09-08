// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/arrange-widgets.ts

import { DASHBOARD_GRID_COLUMNS } from '../../../../../dashboards/client'
import type { WidgetPlacement } from '../../../../../dashboards/draft-edit'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { buildDashboardEditDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import {
  dashboardToolPermission,
  digestLabelFromOutput,
  mutationToToolResult,
} from './dashboard-tool-helpers'
import { resolveDashboardWrite } from './write-tool-helpers'

/** Read one placement off raw args; anything without a widget and a cell is dropped. */
function parsePlacements(value: unknown): WidgetPlacement[] {
  if (!Array.isArray(value)) return []
  const placements: WidgetPlacement[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const widget = typeof record.widget === 'string' ? record.widget : ''
    if (!widget || typeof record.column !== 'number' || typeof record.row !== 'number') continue
    placements.push({
      widget,
      column: record.column,
      row: record.row,
      ...(typeof record.columnSpan === 'number' ? { columnSpan: record.columnSpan } : {}),
      ...(typeof record.rowSpan === 'number' ? { rowSpan: record.rowSpan } : {}),
    })
  }
  return placements
}

/**
 * Move and resize widgets. THE ONE TOOL THAT TAKES COORDINATES, and it takes
 * them as 12-column grid cells rather than pixels.
 *
 * Use it only when the user asks for a specific arrangement: placement is
 * automatic everywhere else, columns are clamped and spans are floored at each
 * kind's minimum, and overlaps are settled by the grid's vertical compactor
 * exactly as they are for a user drag.
 */
export function createArrangeWidgetsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'arrange_widgets',
    permission: dashboardToolPermission('edit'),
    displayName: 'Arrange widgets',
    surfaces: ['builder'],
    description: `Move and resize widgets on the ${DASHBOARD_GRID_COLUMNS}-column grid. Only use this when the user asks for a specific arrangement - every other tool places widgets automatically. Columns are 0-based and clamped; spans are floored at each kind's minimum.`,
    parameters: {
      type: 'object',
      properties: {
        placements: {
          type: 'array',
          description: 'One entry per widget to move.',
          items: {
            type: 'object',
            properties: {
              widget: { type: 'string', description: 'Widget title.' },
              column: { type: 'number', description: `0 to ${DASHBOARD_GRID_COLUMNS - 1}.` },
              row: { type: 'number', description: '0-based row.' },
              columnSpan: { type: 'number' },
              rowSpan: { type: 'number' },
            },
            required: ['widget', 'column', 'row'],
          },
        },
      },
      required: ['placements'],
      additionalProperties: false,
    },
    summary: () => 'Arrange widgets',
    buildDigest: (output) =>
      buildDashboardEditDigest(digestLabelFromOutput(output, 'Arranged widgets'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveDashboardWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }
      const placements = parsePlacements(args.placements)
      if (placements.length === 0) {
        return {
          success: false,
          output: null,
          error: 'placements is required: each entry needs a widget title, a column and a row.',
        }
      }

      const { db } = getDeps()
      // Lazy import - see get-dashboard.ts.
      const { arrangeWidgets } = await import('../../../../../dashboards/draft-edit')
      const result = await arrangeWidgets(db, write.scope, { placements })
      return mutationToToolResult(result, (value) =>
        value.applied
          ? `Arranged ${placements.length} widget${placements.length === 1 ? '' : 's'}`
          : 'Arrange blocked'
      )
    },
  }
}
