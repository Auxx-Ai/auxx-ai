// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/delete-nodes.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { buildWorkflowEditDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import {
  digestLabelFromOutput,
  mutationToToolResult,
  workflowToolPermission,
} from './graph-tool-helpers'
import { resolveWorkflowWrite } from './write-tool-helpers'

/** Delete nodes (a loop container takes its children with it — canvas parity). */
export function createDeleteNodesTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'delete_nodes',
    permission: workflowToolPermission('edit'),
    displayName: 'Delete workflow nodes',
    toolsetSlug: 'workflow.builder',
    surfaces: ['builder'],
    description:
      'Delete nodes from the open workflow draft by title. Deleting a loop deletes its contained nodes too. Pass reconnect: true to bridge each deleted node’s predecessors to its successors.',
    parameters: {
      type: 'object',
      properties: {
        refs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Node titles (or refs) to delete.',
        },
        reconnect: {
          type: 'boolean',
          description: 'Bridge surviving predecessors to surviving successors.',
        },
      },
      required: ['refs'],
      additionalProperties: false,
    },
    summary: (args) => `Delete ${Array.isArray(args.refs) ? args.refs.length : 0} node(s)`,
    buildDigest: (output) =>
      buildWorkflowEditDigest(digestLabelFromOutput(output, 'Deleted nodes'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveWorkflowWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }
      const refs = Array.isArray(args.refs)
        ? args.refs.filter((r): r is string => typeof r === 'string' && r.trim() !== '')
        : []
      if (refs.length === 0) {
        return { success: false, output: null, error: 'refs must name at least one node.' }
      }

      const { db } = getDeps()
      // Lazy import — see get-workflow.ts.
      const { deleteNodes } = await import('../../../../../workflows/graph-edit')
      const result = await deleteNodes(db, {
        ...write.scope,
        refs,
        ...(args.reconnect === true ? { reconnect: true } : {}),
      })
      return mutationToToolResult(result, (value) =>
        value.applied
          ? `Deleted ${refs.length === 1 ? refs[0] : `${refs.length} nodes`}`
          : 'Delete blocked'
      )
    },
  }
}
