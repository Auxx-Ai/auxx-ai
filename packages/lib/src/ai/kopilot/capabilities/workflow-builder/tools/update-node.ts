// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/update-node.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { buildWorkflowEditDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import {
  digestLabelFromOutput,
  mutationToToolResult,
  workflowToolPermission,
} from './graph-tool-helpers'
import { optionalRecord, resolveWorkflowWrite } from './write-tool-helpers'

/** Shallow-merge a friendly config into one node. */
export function createUpdateNodeTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'update_node',
    permission: workflowToolPermission('edit'),
    displayName: 'Update workflow node',
    toolsetSlug: 'workflow.builder',
    surfaces: ['builder'],
    description:
      'Update one node of the open workflow draft: the config is shallow-merged over its current data. Pass only the fields you want to change. Use get_node first to see the current config; the result returns the node, its resolved outputs, and any issues.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Node title (or ref) to update.' },
        config: {
          type: 'object',
          description: 'Friendly config fields to merge — `{{Title.path}}` refs welcome.',
        },
      },
      required: ['ref', 'config'],
      additionalProperties: false,
    },
    summary: (args) => `Update node: ${typeof args.ref === 'string' ? args.ref : ''}`,
    buildDigest: (output) =>
      buildWorkflowEditDigest(digestLabelFromOutput(output, 'Updated node'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveWorkflowWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }
      const ref = typeof args.ref === 'string' ? args.ref.trim() : ''
      const config = optionalRecord(args.config)
      if (!ref || !config) {
        return { success: false, output: null, error: 'ref and config are required.' }
      }

      const { db } = getDeps()
      // Lazy import — see get-workflow.ts.
      const { updateNode } = await import('../../../../../workflows/graph-edit')
      const result = await updateNode(db, { ...write.scope, ref, config })
      return mutationToToolResult(result, (value) =>
        value.applied ? `Updated ${value.node?.title ?? ref}` : `Update ${ref} blocked`
      )
    },
  }
}
