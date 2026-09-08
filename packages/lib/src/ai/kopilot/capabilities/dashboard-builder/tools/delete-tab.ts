// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/delete-tab.ts

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
 * Remove a tab and everything on it. The LAST tab is refused: a doc with no
 * tabs can never be published, and the failure would otherwise surface later as
 * a schema error on a publish the user thought was ready.
 */
export function createDeleteTabTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'delete_tab',
    permission: dashboardToolPermission('edit'),
    displayName: 'Delete tab',
    surfaces: ['builder'],
    description:
      'Remove a tab from the open dashboard draft, along with every widget on it. A dashboard must keep at least one tab, so removing the last one is refused.',
    parameters: {
      type: 'object',
      properties: {
        tab: { type: 'string', description: 'Tab title (a unique prefix works).' },
      },
      required: ['tab'],
      additionalProperties: false,
    },
    summary: (args) => `Delete tab: ${typeof args.tab === 'string' ? args.tab : 'tab'}`,
    buildDigest: (output) =>
      buildDashboardEditDigest(digestLabelFromOutput(output, 'Deleted tab'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveDashboardWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }
      const tab = optionalString(args.tab)
      if (!tab) return { success: false, output: null, error: 'tab is required.' }

      const { db } = getDeps()
      // Lazy import - see get-dashboard.ts.
      const { deleteTab } = await import('../../../../../dashboards/draft-edit')
      const result = await deleteTab(db, write.scope, { tab })
      return mutationToToolResult(result, (value) =>
        value.applied ? `Removed tab ${tab}` : `Delete tab ${tab} blocked`
      )
    },
  }
}
