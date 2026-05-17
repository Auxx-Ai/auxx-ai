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

For 3+ distinct steps (or "review every X" / "do A then B then C"), call \`plan_create\` first with short imperative step labels. Mark each step \`running\` when starting, \`completed\` (optional one-line \`detail\`) when done, \`failed\` with a reason if blocked. Mirror the latest plan in an \`auxx:plan-steps\` fence in your final reply. Single-step lookups don't need a plan.`,
    capabilities: ['Lay out a multi-step plan and track progress as steps complete'],
  }
}
