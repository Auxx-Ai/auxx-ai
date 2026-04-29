// packages/lib/src/ai/agent-framework/tool-bridge.ts

import type { Database } from '@auxx/database'
import { generateId } from '@auxx/utils'
import type { NodeProcessorRegistry } from '../../workflow-engine/core/node-processor-registry'
import { executeSingleNode } from '../../workflow-engine/core/single-node-executor'
import type { ToolDefinition } from '../../workflow-engine/core/tool-registry'
import { ToolRegistry } from '../../workflow-engine/core/tool-registry'
import type { ToolContext } from './tool-context'
import type { AgentToolDefinition, AgentToolResult } from './types'

export interface ToolBridgeConfig {
  /** Node processor registry for workflow node execution */
  nodeRegistry: NodeProcessorRegistry
  /** Database connection for node execution */
  db?: Database
}

/**
 * Convert workflow ToolDefinitions into AgentToolDefinitions.
 * Each tool's execute() calls executeSingleNode() under the hood.
 */
export function buildToolsFromDefinitions(
  toolDefs: ToolDefinition[],
  bridgeConfig: ToolBridgeConfig
): AgentToolDefinition[] {
  return toolDefs
    .filter((def) => def.enabled)
    .map((def) => toolDefinitionToAgentTool(def, bridgeConfig))
}

/**
 * Get all built-in tools from the ToolRegistry as AgentToolDefinitions.
 */
export function getBuiltInTools(bridgeConfig: ToolBridgeConfig): AgentToolDefinition[] {
  const toolRegistry = new ToolRegistry(bridgeConfig.nodeRegistry)
  return buildToolsFromDefinitions(toolRegistry.getBuiltInTools(), bridgeConfig)
}

/**
 * Dispatch a tool call by name from a tools array.
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
  return tool.execute(args, ctx)
}

// ===== INTERNAL =====

function toolDefinitionToAgentTool(
  def: ToolDefinition,
  bridgeConfig: ToolBridgeConfig
): AgentToolDefinition {
  return {
    name: def.name,
    description: def.description,
    parameters: def.inputSchema as Record<string, unknown>,
    execute: async (args: Record<string, unknown>, ctx: ToolContext): Promise<AgentToolResult> => {
      try {
        const node = {
          id: def.sourceNodeId ?? generateId(),
          type: def.nodeType,
          data: { ...def.nodeConfig },
          position: { x: 0, y: 0 },
        }

        const context = {
          workflowId: `agent-${ctx.sessionId ?? ctx.traceId ?? 'unknown'}`,
          executionId: generateId(),
          organizationId: ctx.organizationId,
          userId: ctx.userId,
        }

        const result = await executeSingleNode(
          node,
          args,
          context,
          bridgeConfig.nodeRegistry,
          undefined,
          bridgeConfig.db
        )

        return {
          success: true,
          output: result.outputs ?? result.processData ?? {},
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return { success: false, output: null, error: errorMessage }
      }
    },
  }
}
