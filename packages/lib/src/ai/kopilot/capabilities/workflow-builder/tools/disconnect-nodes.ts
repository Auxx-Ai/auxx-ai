// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/disconnect-nodes.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { buildWorkflowEditDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import {
  digestLabelFromOutput,
  mutationToToolResult,
  workflowToolPermission,
} from './graph-tool-helpers'
import { resolveWorkflowWrite } from './write-tool-helpers'

/** Remove every edge between two nodes (all branches). */
export function createDisconnectNodesTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'disconnect_nodes',
    permission: workflowToolPermission('edit'),
    displayName: 'Disconnect workflow nodes',
    surfaces: ['builder'],
    description:
      'Remove every connection from one node to another in the open workflow draft (all branches).',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source node title.' },
        to: { type: 'string', description: 'Target node title.' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    summary: (args) => `Disconnect ${args.from ?? ''} → ${args.to ?? ''}`,
    buildDigest: (output) =>
      buildWorkflowEditDigest(digestLabelFromOutput(output, 'Disconnected nodes'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveWorkflowWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }
      const from = typeof args.from === 'string' ? args.from.trim() : ''
      const to = typeof args.to === 'string' ? args.to.trim() : ''
      if (!from || !to) return { success: false, output: null, error: 'from and to are required.' }

      const { db } = getDeps()
      // Lazy import — see get-workflow.ts.
      const { disconnectNodes } = await import('../../../../../workflows/graph-edit')
      const result = await disconnectNodes(db, { ...write.scope, from, to })
      return mutationToToolResult(result, (value) =>
        value.applied ? `Disconnected ${from} → ${to}` : `Disconnect ${from} → ${to} blocked`
      )
    },
  }
}
