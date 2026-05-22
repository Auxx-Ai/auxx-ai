// packages/lib/src/ai/agent-framework/tool-bridge.ts

import type { ToolContext } from './tool-context'
import type { AgentToolDefinition, AgentToolResult } from './types'
import { executeToolWithProgress } from './utils'

/**
 * Dispatch a tool call by name from a tools array.
 *
 * Note: the previous `buildToolsFromDefinitions` + `getBuiltInTools` helpers
 * were dropped along with the legacy workflow `ToolRegistry` /
 * `ToolDefinition` shape (Phase 2 — see
 * `plans/workflow/ai/phase-2-ai-processor-migration.md`). The agent framework
 * now consumes only `AgentToolDefinition`s emitted by the kopilot capability
 * factories. Workflow-node-as-tool returns in v2 via a dedicated capability
 * (`createWorkflowNodeCapabilities`).
 */
export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  tools: AgentToolDefinition[],
  ctx: ToolContext
): Promise<AgentToolResult> {
  const tool = tools.find((t) => t.name === toolName)
  if (!tool) {
    return { success: false, output: null, error: `Unknown tool: ${toolName}` }
  }
  // Streaming tools (AsyncGenerator return) drain silently here — this entry
  // point doesn't carry a progress channel; callers that want progress events
  // should go through the agent query loop.
  return executeToolWithProgress(tool, args, ctx)
}
