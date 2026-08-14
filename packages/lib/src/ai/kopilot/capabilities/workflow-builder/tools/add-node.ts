// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/add-node.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { buildWorkflowEditDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import {
  digestLabelFromOutput,
  mutationToToolResult,
  workflowToolPermission,
} from './graph-tool-helpers'
import { optionalRecord, optionalString, resolveWorkflowWrite } from './write-tool-helpers'

/**
 * Add one node to the open workflow's draft. Thin wrapper over graph-edit
 * `addNode` — placement, branch resolution, containment, normalization and
 * validation all live there. Non-authorable types are refused by graph-edit
 * with an honest error naming the type and the authorable set.
 */
export function createAddNodeTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'add_node',
    permission: workflowToolPermission('edit'),
    displayName: 'Add workflow node',
    surfaces: ['builder'],
    description:
      'Add one node to the open workflow draft. Connect it with `after` (predecessor title) and optionally `branch` (branch NAME of the predecessor); place it inside a loop with `inside` (loop title). Do not send coordinates — layout is automatic. The result returns the node, its resolved outputs (wire `{{Title.path}}` refs from these), and any issues.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: "Authorable node type (e.g. 'http', 'find')." },
        title: { type: 'string', description: 'Node title — unique, human-readable.' },
        config: {
          type: 'object',
          description:
            'Friendly config per describe_node_type — `{{Title.path}}` refs, resource slugs, plain prompts.',
        },
        after: { type: 'string', description: 'Predecessor node (title) to connect from.' },
        branch: { type: 'string', description: 'Branch NAME of `after` to leave on.' },
        inside: { type: 'string', description: 'Loop node (title) to place this node inside.' },
      },
      required: ['type'],
      additionalProperties: false,
    },
    summary: (args) => `Add node: ${typeof args.type === 'string' ? args.type : 'node'}`,
    buildDigest: (output) =>
      buildWorkflowEditDigest(digestLabelFromOutput(output, 'Added node'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveWorkflowWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }
      const type = typeof args.type === 'string' ? args.type : ''
      if (!type) return { success: false, output: null, error: 'type is required.' }

      const { db } = getDeps()
      // Lazy import — see get-workflow.ts.
      const { addNode } = await import('../../../../../workflows/graph-edit')
      const result = await addNode(db, {
        ...write.scope,
        type,
        ...(optionalString(args.title) ? { title: optionalString(args.title) } : {}),
        ...(optionalRecord(args.config) ? { config: optionalRecord(args.config) } : {}),
        ...(optionalString(args.after) ? { after: optionalString(args.after) } : {}),
        ...(optionalString(args.branch) ? { branch: optionalString(args.branch) } : {}),
        ...(optionalString(args.inside) ? { inside: optionalString(args.inside) } : {}),
      })
      return mutationToToolResult(result, (value) =>
        value.applied ? `Added ${value.node?.title ?? type}` : `Add ${type} blocked`
      )
    },
  }
}
