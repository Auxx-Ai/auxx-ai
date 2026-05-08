// packages/lib/src/ai/kopilot/capabilities/kopilot/tools/plan-update-step.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { PlanStepStatus } from '../../../types'
import type { GetToolDeps } from '../../types'

/** Statuses accepted by `plan_update_step` — must match `PlanStepStatus`. */
const VALID_STATUSES: PlanStepStatus[] = ['pending', 'running', 'completed', 'failed']

/**
 * Update the status (and optional detail) of a single plan step.
 *
 * Raw output is `{ _planPatch: { stepId, status, detail? } }` — a sentinel
 * the kopilot domain's `transformToolResult` hook expands into
 * `{ plan: <canonical> }` before the LLM sees the tool message. Domain
 * state is mutated in `onToolResult`. Tools can't read `domainState`
 * directly, so the patch is the only thing this tool can emit.
 */
export function createPlanUpdateStepTool(_getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'plan_update_step',
    description:
      'Update the status (and optional one-line detail) of a single plan step. Use to mark a step running before you start it, completed when done, or failed if it hit a blocker. Returns the full updated plan.',
    parameters: {
      type: 'object',
      properties: {
        stepId: {
          type: 'string',
          description:
            'The id of the step to update (from the latest plan returned by plan_create / plan_update_step).',
        },
        status: {
          type: 'string',
          enum: VALID_STATUSES,
          description: 'New status — typically pending → running → completed (or failed).',
        },
        detail: {
          type: 'string',
          description: 'Optional one-line note (outcome, blocker reason, etc.).',
        },
      },
      required: ['stepId', 'status'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const stepId = args.stepId as string
      const status = args.status as PlanStepStatus
      const detail = args.detail as string | undefined
      if (!VALID_STATUSES.includes(status)) {
        return { success: false, output: null, error: `invalid status: ${status}` }
      }
      return {
        success: true,
        output: {
          _planPatch: { stepId, status, ...(detail !== undefined ? { detail } : {}) },
        },
      }
    },
  }
}
