// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/apply-template.ts

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
 * Install a curated template into an EMPTY draft — the same
 * create-from-template path the router uses (fresh node ids, refs rewritten,
 * org-resolved slugs, derived trigger columns).
 */
export function createApplyTemplateTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'apply_template',
    permission: workflowToolPermission('edit'),
    displayName: 'Apply workflow template',
    toolsetSlug: 'workflow.builder',
    surfaces: ['builder'],
    description:
      'Install a workflow template into the open EMPTY draft (it refuses when nodes exist). Find template ids with find_workflow_templates — never invent one. Curated templates may contain node types you cannot author; those install fine but stay read-only to you.',
    parameters: {
      type: 'object',
      properties: {
        templateId: {
          type: 'string',
          description: 'Template id from find_workflow_templates.',
        },
      },
      required: ['templateId'],
      additionalProperties: false,
    },
    summary: (args) =>
      `Apply template ${typeof args.templateId === 'string' ? args.templateId : ''}`,
    buildDigest: (output) =>
      buildWorkflowEditDigest(digestLabelFromOutput(output, 'Applied template'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveWorkflowWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }
      const templateId = typeof args.templateId === 'string' ? args.templateId.trim() : ''
      if (!templateId) return { success: false, output: null, error: 'templateId is required.' }

      const { db } = getDeps()
      // Lazy import — see get-workflow.ts.
      const { applyTemplate } = await import('../../../../../workflows/graph-edit')
      const result = await applyTemplate(db, {
        ...write.scope,
        templateId,
        userId: agentDeps.userId,
      })
      return mutationToToolResult(result, (value) =>
        value.applied
          ? `Applied template (${value.graphSummary.nodeCount} nodes)`
          : 'Apply template blocked'
      )
    },
  }
}
