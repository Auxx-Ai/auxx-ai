// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/add-tab.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { buildDashboardEditDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import {
  dashboardToolPermission,
  digestLabelFromOutput,
  mutationToToolResult,
} from './dashboard-tool-helpers'
import { optionalString, resolveDashboardWrite } from './write-tool-helpers'

/** Append a tab to the open dashboard draft. Blank titles fall back to `Tab <n>`. */
export function createAddTabTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'add_tab',
    permission: dashboardToolPermission('edit'),
    displayName: 'Add tab',
    surfaces: ['builder'],
    description:
      'Add a tab to the open dashboard draft. Titles are made unique automatically; a blank one becomes "Tab <n>".',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Tab title.' },
        icon: { type: 'string', description: 'Optional icon id.' },
      },
      additionalProperties: false,
    },
    summary: (args) => `Add tab: ${typeof args.title === 'string' ? args.title : 'tab'}`,
    buildDigest: (output) =>
      buildDashboardEditDigest(digestLabelFromOutput(output, 'Added tab'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveDashboardWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }
      const title = optionalString(args.title)

      const { db } = getDeps()
      // Lazy import - see get-dashboard.ts.
      const { addTab, updateTab } = await import('../../../../../dashboards/draft-edit')
      const result = await addTab(db, write.scope, { ...(title ? { title } : {}) })
      // `addTab` takes no icon (the transform it wraps does not), so an icon is
      // a second, targeted write against the tab that was just created rather
      // than a widened op signature.
      const icon = optionalString(args.icon)
      const added = result.isOk() ? result.value.layoutSummary.tabs.at(-1)?.ref : undefined
      if (icon && added && result.isOk() && result.value.applied) {
        const withIcon = await updateTab(db, write.scope, { tab: added, icon })
        return mutationToToolResult(withIcon, () => `Added tab ${added}`)
      }
      return mutationToToolResult(result, (value) =>
        value.applied
          ? `Added tab ${value.layoutSummary.tabs.at(-1)?.ref ?? ''}`.trim()
          : 'Add tab blocked'
      )
    },
  }
}
