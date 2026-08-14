// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/connect-nodes.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { buildWorkflowEditDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import {
  digestLabelFromOutput,
  mutationToToolResult,
  workflowToolPermission,
} from './graph-tool-helpers'
import { optionalString, resolveWorkflowWrite } from './write-tool-helpers'

/** Connect two nodes — branch handles resolved by NAME through the manifest. */
export function createConnectNodesTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'connect_nodes',
    permission: workflowToolPermission('edit'),
    displayName: 'Connect workflow nodes',
    surfaces: ['builder'],
    description:
      'Connect two nodes of the open workflow draft. For a branching source (if-else etc.), pass the branch NAME. Connecting a loop child back to its own loop wires the loop-back edge automatically.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source node title.' },
        to: { type: 'string', description: 'Target node title.' },
        branch: { type: 'string', description: 'Branch NAME of `from` to leave on.' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    summary: (args) => `Connect ${args.from ?? ''} → ${args.to ?? ''}`,
    buildDigest: (output) =>
      buildWorkflowEditDigest(digestLabelFromOutput(output, 'Connected nodes'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveWorkflowWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }
      const from = typeof args.from === 'string' ? args.from.trim() : ''
      const to = typeof args.to === 'string' ? args.to.trim() : ''
      if (!from || !to) return { success: false, output: null, error: 'from and to are required.' }

      const branch = optionalString(args.branch)
      const { db } = getDeps()
      // Lazy import — see get-workflow.ts.
      const { connectNodes } = await import('../../../../../workflows/graph-edit')
      const result = await connectNodes(db, {
        ...write.scope,
        from,
        to,
        ...(branch ? { branch } : {}),
      })
      return mutationToToolResult(result, (value) =>
        value.applied
          ? `Connected ${from} → ${to}${branch ? ` [${branch}]` : ''}`
          : `Connect ${from} → ${to} blocked`
      )
    },
  }
}
