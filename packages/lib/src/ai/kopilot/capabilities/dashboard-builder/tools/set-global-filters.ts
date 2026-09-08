// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/set-global-filters.ts

import type { DateRangePreset } from '../../../../../dashboards/client'
import type { GlobalFilterInput } from '../../../../../dashboards/draft-edit'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { buildDashboardEditDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import {
  dashboardToolPermission,
  digestLabelFromOutput,
  mutationToToolResult,
} from './dashboard-tool-helpers'
import {
  FILTER_PROPERTIES,
  optionalRecord,
  optionalString,
  parseConditions,
  resolveDashboardWrite,
  toConditionGroups,
} from './write-tool-helpers'

/** Read the per-source filter list off raw args. Entries without a source are dropped. */
function parseFilters(value: unknown): GlobalFilterInput[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: GlobalFilterInput[] = []
  for (const entry of value) {
    const record = optionalRecord(entry)
    const source = record ? optionalString(record.source) : undefined
    if (!record || !source) continue
    const conditions = parseConditions(record.filters) ?? []
    out.push({
      source,
      groups: toConditionGroups(conditions, record.filterMatch === 'any' ? 'any' : 'all'),
    })
  }
  return out
}

/**
 * Replace the dashboard-level filter DEFAULTS.
 *
 * These are the versioned defaults stored on the layout doc, NOT the viewer's
 * live picks. Those are URL state and are not reachable from the server at all,
 * so a caller that "applies a filter" here and expects the user's open
 * dashboard to change what it shows is wrong twice over: the user has their own
 * selection, and it wins. Say so when reporting the result.
 */
export function createSetGlobalFiltersTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'set_global_filters',
    permission: dashboardToolPermission('edit'),
    displayName: 'Set global filters',
    surfaces: ['builder'],
    description:
      "Replace the dashboard's DEFAULT global filters and date range - what a viewer sees before they change anything. This does not change what the user is looking at right now: their own filter picks are URL state and win over these defaults. Conditions attach per source and only reach widgets on that source.",
    parameters: {
      type: 'object',
      properties: {
        dateRange: {
          type: 'string',
          description:
            "Default date-range preset (e.g. 'last30Days', 'allTime'), or null to clear it.",
        },
        filters: {
          type: 'array',
          description:
            'Default conditions per source. Each entry is { source, filters: [{ field, operator, value }], filterMatch? }. Pass [] to clear every default condition.',
          items: {
            type: 'object',
            properties: {
              source: {
                type: 'string',
                description: 'Entity source NAME. System tables cannot carry global conditions.',
              },
              ...FILTER_PROPERTIES,
            },
            required: ['source', 'filters'],
          },
        },
      },
      additionalProperties: false,
    },
    summary: () => 'Set dashboard default filters',
    buildDigest: (output) =>
      buildDashboardEditDigest(digestLabelFromOutput(output, 'Set default filters'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveDashboardWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }

      const conditions = parseFilters(args.filters)
      const dateRange =
        args.dateRange === null
          ? null
          : optionalString(args.dateRange)
            ? (optionalString(args.dateRange) as DateRangePreset)
            : undefined
      if (conditions === undefined && dateRange === undefined) {
        return {
          success: false,
          output: null,
          error: 'Pass filters, dateRange, or both. Nothing to set.',
        }
      }

      const { db } = getDeps()
      // Lazy import - see get-dashboard.ts.
      const { setGlobalFilters } = await import('../../../../../dashboards/draft-edit')
      const result = await setGlobalFilters(db, write.scope, {
        ...(conditions !== undefined ? { conditions } : {}),
        ...(dateRange !== undefined ? { dateRange } : {}),
      })
      return mutationToToolResult(result, (value) =>
        value.applied ? 'Set the dashboard default filters' : 'Set default filters blocked'
      )
    },
  }
}
