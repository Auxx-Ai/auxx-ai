// packages/lib/src/ai/kopilot/capabilities/workflow/index.ts

import type { GetToolDeps, PageCapability } from '../types'
import { assignVariableTool } from './assign-variable'

/**
 * Page identifier for the workflow AI node — distinguishes workflow-native
 * tools from the global / chat-page capability surfaces.
 */
export const WORKFLOW_AI_NODE_PAGE = 'workflow.ai-node'

/**
 * Toolset slug grouping every workflow-native tool. Uses a `<page>.<group>`
 * shape to make it visible-but-distinct from the `auxx:<group>` namespace
 * shared by the app-backed kopilot toolsets.
 */
export const WORKFLOW_NATIVE_TOOLSET_SLUG = 'workflow.variable'

/**
 * Stand up the workflow AI node's native capability set. Phase 1 ships exactly
 * one tool — `assign_variable` — so the engine has a real built-in to exercise
 * end-to-end in Phase 2. App-backed tools (mail, entities, knowledge, …) come
 * in through `createAppCapabilities()` separately.
 */
export function createNativeWorkflowCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: WORKFLOW_AI_NODE_PAGE,
    tools: [assignVariableTool(getDeps)],
  }
}

export { assignVariableTool } from './assign-variable'
