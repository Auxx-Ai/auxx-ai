// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/get-workflow.ts

import type { EdgeSummary } from '../../../../../workflows/graph-edit/types'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { projectOutputs, workflowToolPermission } from './graph-tool-helpers'
import { resolveWorkflowAuthoring } from './workflow-authoring-guard'

const CONFIG_SUMMARY_MAX = 140

/** One-line config summary — bodies stay behind `get_node` (04 §1). */
function summarizeConfig(config: Record<string, unknown>): string {
  const line = JSON.stringify(config) ?? '{}'
  return line.length > CONFIG_SUMMARY_MAX ? `${line.slice(0, CONFIG_SUMMARY_MAX - 1)}…` : line
}

/** `Title → Title [branch]` — the spec's edge rendering. */
function renderEdge(edge: EdgeSummary): string {
  return `${edge.from} → ${edge.to}${edge.branch ? ` [${edge.branch}]` : ''}${
    edge.isLoopBack ? ' [loop-back]' : ''
  }`
}

/**
 * The whole draft, compact: trigger, per-node summaries (one-line config,
 * resolved output refs), edges as `Title → Title [branch]`, current issues.
 * Config BODIES are deliberately omitted — `get_node` fetches those.
 */
export function createGetWorkflowTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_workflow',
    permission: workflowToolPermission('view'),
    displayName: 'Get workflow',
    toolsetSlug: 'workflow.builder',
    surfaces: ['builder'],
    idempotent: true,
    description:
      'Read the open workflow draft: trigger, every node (type, title, one-line config summary, resolved output refs), edges, and current issues. Use get_node for a node’s full config.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_args, agentDeps) => {
      const auth = await resolveWorkflowAuthoring(getDeps, agentDeps, 'view')
      if (!auth.ok) return { success: false, output: null, error: auth.error }

      const { db } = getDeps()
      // Lazy import — the graph-edit barrel reads the org cache at import
      // time; keeping it out of the capability's import graph keeps tests
      // free to mock the module wholesale.
      const { readDraft } = await import('../../../../../workflows/graph-edit')
      const result = await readDraft(db, {
        workflowAppId: auth.workflowAppId,
        organizationId: agentDeps.organizationId,
      })
      if (result.isErr()) {
        return { success: false, output: null, error: result.error.message }
      }
      const draft = result.value
      return {
        success: true,
        output: {
          name: draft.name,
          triggerType: draft.triggerType ?? null,
          nodeCount: draft.graphSummary.nodeCount,
          nodes: draft.nodes.map((node) => ({
            ref: node.ref,
            type: node.type,
            title: node.title,
            ...(node.inside ? { inside: node.inside } : {}),
            config: summarizeConfig(node.config),
            outputs: projectOutputs(draft.outputs[node.ref]).map((o) => o.ref),
          })),
          edges: draft.edges.map(renderEdge),
          issues: draft.issues,
        },
      }
    },
  }
}
