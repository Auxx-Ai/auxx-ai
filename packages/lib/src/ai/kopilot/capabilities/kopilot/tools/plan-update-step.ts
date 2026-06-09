// packages/lib/src/ai/kopilot/capabilities/kopilot/tools/plan-update-step.ts

import { z } from 'zod'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { PlanState, PlanStepStatus } from '../../../types'
import type { GetToolDeps } from '../../types'

/**
 * Success output of `plan_update_step` — the full canonical plan after the
 * patch (`null` only on the no-active-plan error). The LLM mirrors this into
 * its `auxx:plan-steps` fence.
 */
const PlanUpdateStepOutput = z.object({
  plan: z
    .object({
      steps: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          status: z.enum(['pending', 'running', 'completed', 'failed']),
          detail: z.string().optional(),
        })
      ),
      createdAt: z.number(),
      updatedAt: z.number(),
    })
    .nullable(),
})

/** Statuses accepted by `plan_update_step` — must match `PlanStepStatus`. */
const VALID_STATUSES: PlanStepStatus[] = ['pending', 'running', 'completed', 'failed']

/**
 * Update the status (and optional detail) of a single plan step.
 *
 * Reads the active plan from `var:plan` (via `ctx.context`), patches the named
 * step, writes it back, and returns the full updated plan. Replaces the old
 * `_planPatch` sentinel + the kopilot domain's `onToolResult`/`transformToolResult`
 * machinery — now that tools can read shared context, the tool owns the logic.
 */
export function createPlanUpdateStepTool(_getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'plan_update_step',
    displayName: 'Update plan step',
    category: 'control',
    outputSchema: PlanUpdateStepOutput,
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
    execute: async (args, ctx) => {
      const stepId = args.stepId as string
      const status = args.status as PlanStepStatus
      const detail = args.detail as string | undefined
      if (!VALID_STATUSES.includes(status)) {
        return { success: false, output: null, error: `invalid status: ${status}` }
      }

      const plan = (await ctx.context.read('var:plan')) as PlanState | undefined
      if (!plan) {
        return {
          success: false,
          output: { plan: null },
          error: 'no active plan; call plan_create first',
        }
      }

      const idx = plan.steps.findIndex((s) => s.id === stepId)
      if (idx < 0) {
        return {
          success: false,
          output: { plan },
          error: `no plan step with id "${stepId}"; current plan attached`,
        }
      }

      const steps = plan.steps.map((s, i) =>
        i === idx ? { ...s, status, ...(detail !== undefined ? { detail } : {}) } : s
      )
      const updated = { ...plan, steps, updatedAt: Date.now() }
      await ctx.context.write('var:plan', updated)
      return { success: true, output: { plan: updated } }
    },
  }
}
