// apps/web/src/components/workflow/nodes/core/ai/types.ts

import type { ToolsetEntry } from '@auxx/lib/agents/client'
import type { CatalogAiNodeData } from '@auxx/lib/workflow-engine/client'
import type { Node } from '@xyflow/react'
import type { SpecificNode } from '~/components/workflow/types'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/ai`, which is also the home of the
// model-config vocabulary the other AI nodes share); re-exported here so no
// web import churns. AiNodeData narrows `type` to the web NodeType enum, same
// as BaseNodeData does over its lib counterpart.
export type {
  AiCompletionParams,
  AiFiles,
  AiModel,
  PromptTemplate,
  StructuredOutputConfig,
} from '@auxx/lib/workflow-engine/client'
export {
  AiModelMode,
  AiModelProvider,
  PromptRole,
} from '@auxx/lib/workflow-engine/client'

/**
 * Re-export the shared ToolsetEntry shape for convenience. The flat AI-node
 * data uses the same shape as `Agent.toolsets` so the agent-framework picker
 * dialog (`ToolSelectDialog`) and the back-end `filterToolsByToolsets`
 * pipeline work without translation. See `plans/workflow/ai/phase-3-frontend-picker-migration.md`.
 */
export type { ToolsetEntry }

/**
 * Node data for AI nodes — flat tools shape (Phase 3). The legacy
 * `tools: AiToolsConfig` nested block is gone; see the Phase 3 plan.
 */
export interface AiNodeData extends CatalogAiNodeData {
  type: NodeType
}

/**
 * Full AI node type for React Flow
 */
export type AiNode = SpecificNode<'ai', AiNodeData>

/**
 * Tool call from AI provider
 */
export interface AiToolCall {
  id: string
  name: string
  arguments: Record<string, any>
}

/**
 * Tool execution result
 */
export interface AiToolResult {
  toolCallId: string
  toolName: string
  success: boolean
  output: Record<string, any>
  error?: string
  executionTime?: number
}

/**
 * Execution result for AI nodes
 */
export interface AiExecutionResult {
  text: string
  structured_output?: Record<string, any>
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  tool_calls?: AiToolCall[]
  tool_results?: AiToolResult[]
}

// Re-export for convenience
export type { Node }
