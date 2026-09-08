// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/update-tab.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { buildDashboardEditDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import {
  dashboardToolPermission,
  digestLabelFromOutput,
  mutationToToolResult,
} from './dashboard-tool-helpers'
import { optionalString, resolveDashboardWrite } from './write-tool-helpers'

/** Rename a tab or change its icon. Address it by its current title. */
export function createUpdateTabTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'update_tab',
    permission: dashboardToolPermission('edit'),
    displayName: 'Update tab',
    surfaces: ['builder'],
    description:
      'Rename a tab on the open dashboard draft, or change its icon. Address the tab by its current title. Pass icon: null to remove the icon.',
    parameters: {
      type: 'object',
      properties: {
        tab: { type: 'string', description: 'Current tab title (a unique prefix works).' },
        title: { type: 'string', description: 'New title.' },
        icon: { type: 'string', description: 'New icon id, or null to remove it.' },
      },
      required: ['tab'],
      additionalProperties: false,
    },
    summary: (args) => `Update tab: ${typeof args.tab === 'string' ? args.tab : 'tab'}`,
    buildDigest: (output) =>
      buildDashboardEditDigest(digestLabelFromOutput(output, 'Updated tab'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveDashboardWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }
      const tab = optionalString(args.tab)
      if (!tab) return { success: false, output: null, error: 'tab is required.' }

      const { db } = getDeps()
      // Lazy import - see get-dashboard.ts.
      const { updateTab } = await import('../../../../../dashboards/draft-edit')
      const result = await updateTab(db, write.scope, {
        tab,
        ...(typeof args.title === 'string' ? { title: args.title } : {}),
        ...(args.icon === null
          ? { icon: null }
          : optionalString(args.icon)
            ? { icon: optionalString(args.icon) as string }
            : {}),
      })
      return mutationToToolResult(result, (value) =>
        value.applied
          ? `Updated tab ${optionalString(args.title) ?? tab}`
          : `Update tab ${tab} blocked`
      )
    },
  }
}
