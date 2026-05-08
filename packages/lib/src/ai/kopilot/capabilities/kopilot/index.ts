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
    capabilities: ['Lay out a multi-step plan and track progress as steps complete'],
  }
}
