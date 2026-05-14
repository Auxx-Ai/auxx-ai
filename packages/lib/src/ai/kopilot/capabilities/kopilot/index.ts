// packages/lib/src/ai/kopilot/capabilities/kopilot/index.ts

import type { GetToolDeps, PageCapability } from '../types'
import { createPlanCreateTool } from './tools/plan-create'
import { createPlanUpdateStepTool } from './tools/plan-update-step'

/**
 * Kopilot self-management capabilities — plan/track multi-step work.
 * Registered globally so the agent can plan from any page.
 */
export function createKopilotCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: '__global__',
    tools: [createPlanCreateTool(getDeps), createPlanUpdateStepTool(getDeps)],
    systemPromptAddition: `## When to plan

For multi-step tasks (3+ distinct steps, "review every X", "do A then B then C"), call \`plan_create\` *before* executing the work. Pass an ordered list of short imperative steps. Then:

- Mark the step you're starting with \`plan_update_step({ stepId, status: 'running' })\`.
- Mark it \`'completed'\` (with an optional one-line \`detail\`) when done.
- Mark \`'failed'\` if it hit a blocker; explain in \`detail\`.

Always emit an \`auxx:plan-steps\` fence in your final reply mirroring the latest plan, copying step labels and statuses verbatim from the most recent \`plan_create\` / \`plan_update_step\` result.

Single-step lookups don't need a plan. "Find Carolin's email" — no plan. "Review my open tickets and reply where useful" — yes plan.`,
    capabilities: ['Lay out a multi-step plan and track progress as steps complete'],
  }
}
