// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/replace-graph.ts

import type {
  ReplaceGraphEdgeSpec,
  ReplaceGraphNodeSpec,
} from '../../../../../workflows/graph-edit/ops'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { buildWorkflowEditDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import {
  digestLabelFromOutput,
  mutationToToolResult,
  workflowToolPermission,
} from './graph-tool-helpers'
import { resolveWorkflowWrite } from './write-tool-helpers'

/**
 * Author a whole graph at once. Graph-edit restricts this to EMPTY drafts
 * (decision 2026-08-13) — the tool surfaces that refusal honestly rather than
 * flattening an existing graph.
 */
export function createReplaceGraphTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'replace_graph',
    permission: workflowToolPermission('edit'),
    displayName: 'Build workflow graph',
    toolsetSlug: 'workflow.builder',
    surfaces: ['builder'],
    description:
      'Author a whole workflow graph in one call — ONLY on an empty draft (it refuses when nodes exist; edit incrementally instead). Nodes are referenced by title in edges and configs; positions are laid out automatically.',
    parameters: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          description: 'Nodes to create.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'Authorable node type.' },
              title: { type: 'string' },
              config: { type: 'object', description: 'Friendly config per describe_node_type.' },
              inside: { type: 'string', description: 'Title of the loop this node lives inside.' },
            },
            required: ['type'],
            additionalProperties: false,
          },
        },
        edges: {
          type: 'array',
          description: 'Connections between the new nodes, by title.',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
              branch: { type: 'string', description: 'Branch NAME of `from`.' },
            },
            required: ['from', 'to'],
            additionalProperties: false,
          },
        },
      },
      required: ['nodes', 'edges'],
      additionalProperties: false,
    },
    summary: (args) => `Build graph: ${Array.isArray(args.nodes) ? args.nodes.length : 0} node(s)`,
    buildDigest: (output) =>
      buildWorkflowEditDigest(digestLabelFromOutput(output, 'Built workflow graph'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveWorkflowWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }

      const nodes = Array.isArray(args.nodes) ? (args.nodes as ReplaceGraphNodeSpec[]) : []
      const edges = Array.isArray(args.edges) ? (args.edges as ReplaceGraphEdgeSpec[]) : []
      if (nodes.length === 0) {
        return { success: false, output: null, error: 'nodes must contain at least one node.' }
      }

      const { db } = getDeps()
      // Lazy import — see get-workflow.ts.
      const { replaceGraph } = await import('../../../../../workflows/graph-edit')
      const result = await replaceGraph(db, { ...write.scope, nodes, edges })
      return mutationToToolResult(result, (value) =>
        value.applied
          ? `Built graph with ${value.graphSummary.nodeCount} nodes`
          : 'Build graph blocked'
      )
    },
  }
}
