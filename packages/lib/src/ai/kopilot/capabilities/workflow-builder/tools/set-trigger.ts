// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/set-trigger.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { buildWorkflowEditDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import {
  digestLabelFromOutput,
  mutationToToolResult,
  workflowToolPermission,
} from './graph-tool-helpers'
import { optionalRecord, resolveWorkflowWrite } from './write-tool-helpers'

/**
 * Set the workflow's trigger — in-graph trigger types only. Retypes an
 * existing trigger node IN PLACE (same id, outgoing edges kept) so downstream
 * `{{Trigger.x}}` refs survive; creates one when the graph has none.
 */
export function createSetTriggerTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'set_trigger',
    permission: workflowToolPermission('edit'),
    displayName: 'Set workflow trigger',
    surfaces: ['builder'],
    description:
      "Set the open workflow's trigger (what starts it). An existing trigger node is retyped in place — its title, position, and outgoing connections survive; with no trigger yet, one is created. In-graph trigger types only (e.g. 'manual', 'scheduled', 'resource-trigger', 'message-received').",
    parameters: {
      type: 'object',
      properties: {
        triggerType: {
          type: 'string',
          description: "Trigger NODE type (e.g. 'resource-trigger').",
        },
        config: {
          type: 'object',
          description:
            "Friendly trigger config (e.g. { operation: 'created', resourceType: 'ticket' }).",
        },
      },
      required: ['triggerType'],
      additionalProperties: false,
    },
    summary: (args) =>
      `Set trigger: ${typeof args.triggerType === 'string' ? args.triggerType : ''}`,
    buildDigest: (output) =>
      buildWorkflowEditDigest(digestLabelFromOutput(output, 'Set trigger'), output),
    execute: async (args, agentDeps) => {
      const write = await resolveWorkflowWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }
      const triggerType = typeof args.triggerType === 'string' ? args.triggerType.trim() : ''
      if (!triggerType) return { success: false, output: null, error: 'triggerType is required.' }

      const config = optionalRecord(args.config)
      const { db } = getDeps()
      // Lazy import — see get-workflow.ts.
      const { setTrigger } = await import('../../../../../workflows/graph-edit')
      const result = await setTrigger(db, {
        ...write.scope,
        triggerType,
        ...(config ? { config } : {}),
      })
      return mutationToToolResult(result, (value) =>
        value.applied
          ? `Set trigger to ${value.node?.title ?? triggerType}`
          : `Set trigger ${triggerType} blocked`
      )
    },
  }
}
