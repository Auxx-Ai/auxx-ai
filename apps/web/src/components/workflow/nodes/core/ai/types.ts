// apps/web/src/components/workflow/nodes/core/ai/types.ts

import type { Node } from '@xyflow/react'
import type { BaseNodeData, SpecificNode } from '~/components/workflow/types'

/**
 * Prompt roles for AI conversation
 */
export enum PromptRole {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant',
}

/**
 * AI model modes
 */
export enum AiModelMode {
  CHAT = 'chat',
  COMPLETION = 'completion',
}

/**
 * AI model providers
 */
export enum AiModelProvider {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GOOGLE = 'google',
  MISTRAL = 'mistral',
}

/**
 * AI model completion parameters
 */
export interface AiCompletionParams {
  temperature: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
}

/**
 * AI model configuration
 */
export interface AiModel {
  provider: string
  name: string
  mode: AiModelMode
  completion_params: AiCompletionParams
}

/**
 * Prompt template item
 */
export interface PromptTemplate {
  role: PromptRole
  text: string
  editorContent?: string // Store the original editor content (JSON/HTML)
}

/**
 * Context configuration for AI node
 */
export interface AiContext {
  enabled: boolean
  variable_selector: string[]
}

/**
 * Vision configuration for AI node
 */
export interface AiVision {
  enabled: boolean
}

export interface StructuredOutputConfig {
  enabled: boolean
  schema?: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
    additionalProperties?: boolean
  }
}

/**
 * Tools configuration for AI nodes
 */
export interface AiToolsConfig {
  enabled: boolean
  allowedNodeIds?: string[] // Specific workflow nodes to expose as tools
  allowedBuiltInTools?: string[] // Specific built-in tools to enable
  maxConcurrentTools?: number // Limit concurrent tool executions
  autoInvoke?: boolean // Auto-invoke tools vs manual approval

  // Tool-specific credential mappings
  toolCredentials?: Record<string, string> // toolId -> credentialId

  // Default credential fallbacks per tool type/node type
  defaultCredentials?: Record<string, string> // nodeType -> credentialId
}

/**
 * Node data for AI nodes
 */
export interface AiNodeData extends BaseNodeData {
  model: AiModel
  prompt_template: PromptTemplate[]
  context: AiContext
  vision: AiVision
  structured_output: StructuredOutputConfig
  tools: AiToolsConfig
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
