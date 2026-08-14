// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/get-node.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { projectNode, projectOutputs, workflowToolPermission } from './graph-tool-helpers'
import { resolveWorkflowAuthoring } from './workflow-authoring-guard'

/**
 * One node in full: the agent-facing config (friendly `{{Title.path}}` refs,
 * rendered by graph-edit), its resolved outputs, and its issues.
 */
export function createGetNodeTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_node',
    permission: workflowToolPermission('view'),
    displayName: 'Get node',
    surfaces: ['builder'],
    idempotent: true,
    description:
      'Read one node of the open workflow in full: complete config, resolved outputs (wire references from these), and its current issues. Address it by title or ref from get_workflow.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Node title (or ref/id) as returned by the tools.' },
      },
      required: ['ref'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const auth = await resolveWorkflowAuthoring(getDeps, agentDeps, 'view')
      if (!auth.ok) return { success: false, output: null, error: auth.error }
      const ref = typeof args.ref === 'string' ? args.ref.trim() : ''
      if (!ref) return { success: false, output: null, error: 'ref is required.' }

      const { db } = getDeps()
      // Lazy import — see get-workflow.ts.
      const { readDraft } = await import('../../../../../workflows/graph-edit')
      const result = await readDraft(db, {
        workflowAppId: auth.workflowAppId,
        organizationId: agentDeps.organizationId,
      })
      if (result.isErr()) {
        return { success: false, output: null, error: result.error.message }
      }
      const draft = result.value

      const lowered = ref.toLowerCase()
      const node = draft.nodes.find(
        (n) => n.ref === ref || n.id === ref || n.title.toLowerCase() === lowered
      )
      if (!node) {
        const available = draft.nodes.map((n) => n.ref).join(', ')
        return {
          success: false,
          output: null,
          error: `No node "${ref}" in this workflow. Nodes: ${available || '(none)'}.`,
        }
      }

      return {
        success: true,
        output: {
          node: projectNode(node),
          outputs: projectOutputs(draft.outputs[node.ref]),
          issues: draft.issues.filter((issue) => issue.nodeRef === node.ref),
        },
      }
    },
  }
}
