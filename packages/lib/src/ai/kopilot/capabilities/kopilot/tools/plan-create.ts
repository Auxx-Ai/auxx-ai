// packages/lib/src/ai/kopilot/capabilities/kopilot/tools/plan-create.ts

import { generateId } from '@auxx/utils/generateId'
import { z } from 'zod'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

/** Success output of `plan_create` — the canonical plan with timestamped steps. */
const PlanCreateOutput = z.object({
  plan: z.object({
    steps: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        status: z.literal('pending'),
        detail: z.string().optional(),
      })
    ),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
})

/** Hard upper bound on plan size — beyond this, the agent should split tasks. */
const MAX_STEPS = 30
/** Per-step label cap — keeps the rendered fence readable and tokens bounded. */
const MAX_LABEL_LEN = 200

/**
 * Create or replace the active plan for the kopilot session.
 *
 * Output shape: `{ plan: PlanState }` — the canonical plan the agent should
 * mirror verbatim into an `auxx:plan-steps` fence in its final reply. The plan
 * is persisted to `var:plan` via `ctx.context`, so `plan_update_step` (and
 * later turns) can read and patch it — no bespoke `domainState.plan` machinery.
 */
export function createPlanCreateTool(_getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'plan_create',
    displayName: 'Create plan',
    category: 'control',
    outputSchema: PlanCreateOutput,
    description:
      "Create or replace the active plan for this session. Call when the user asks for a multi-step task (review N tickets, process a list, multi-stage research). Each step is a short imperative title; statuses start as 'pending'. Returns the canonical plan you should mirror in the auxx:plan-steps fence.",
    usageNotes:
      "Call plan_create EARLY when the user's request has 3+ distinct steps. After this, mark steps in flight with plan_update_step({stepId, status:'running'}) and on completion with plan_update_step({stepId, status:'completed', detail?}). Always emit an auxx:plan-steps fence in your final reply mirroring the latest plan returned by these tools.",
    parameters: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: `Ordered list of steps (max ${MAX_STEPS}). Each step is a short imperative title — under ${MAX_LABEL_LEN} chars.`,
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Imperative step title' },
              detail: { type: 'string', description: 'Optional one-line context' },
            },
            required: ['label'],
            additionalProperties: false,
          },
        },
      },
      required: ['steps'],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const rawSteps = (args.steps as Array<{ label: string; detail?: string }>) ?? []
      if (rawSteps.length === 0) {
        return { success: false, output: null, error: 'plan must have at least one step' }
      }
      if (rawSteps.length > MAX_STEPS) {
        return {
          success: false,
          output: null,
          error: `plan exceeds max ${MAX_STEPS} steps (got ${rawSteps.length})`,
        }
      }
      const now = Date.now()
      const steps = rawSteps.map((s) => ({
        id: generateId('plan-step'),
        label: s.label.slice(0, MAX_LABEL_LEN),
        status: 'pending' as const,
        ...(s.detail ? { detail: s.detail } : {}),
      }))
      const plan = { steps, createdAt: now, updatedAt: now }
      await ctx.context.write('var:plan', plan)
      return { success: true, output: { plan } }
    },
  }
}
