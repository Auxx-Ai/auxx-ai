// apps/web/src/components/workflow/nodes/core/ai/types.ts

import type { ToolsetEntry } from '@auxx/lib/agents/client'
import type { TiptapDoc } from '@auxx/lib/tiptap'
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
  useDefault?: boolean
  provider: string
  name: string
  mode: AiModelMode
  completion_params: AiCompletionParams
}

/**
 * Prompt template item. Storage shape after Phase 4: the prompt body is a
 * Tiptap doc (`{ type: 'doc', content: [...] }`) so `variable-node` and
 * `reference` chips round-trip without lossy text serialization.
 *
 * Phase 5 reads `.json` directly via `docToText({ variables, references })`.
 * The legacy `text: string` field is gone — no production users (see
 * `project_no_production_users.md`), hard cut.
 */
export interface PromptTemplate {
  role: PromptRole
  json: TiptapDoc
}

/**
 * Context configuration for AI node
 */
export interface AiContext {
  enabled: boolean
  variable_selector: string[]
}

/**
 * Files configuration for AI node
 */
export interface AiFiles {
  enabled: boolean
  input: string // single file reference (variable ref or file:id constant)
  isConstant: boolean // true = constant file picker, false = variable reference
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
export interface AiNodeData extends BaseNodeData {
  model: AiModel
  prompt_template: PromptTemplate[]
  context: AiContext
  files: AiFiles
  structured_output: StructuredOutputConfig

  /** Master gate for the entire tool surface on this node. */
  toolsEnabled?: boolean
  /** Per-toolset enablement. Mirrors `Agent.toolsets`. */
  toolsets?: ToolsetEntry[]
  /** Per-app explicit credential pin. Mirrors `Agent.appAccounts`. */
  appAccounts?: Record<string, { credId: string }>
  /** Approval mode reserved for future use; v1 is always `auto`. */
  approvalMode?: 'auto'
  /** Default 10 for AI node; agent default is 30. */
  maxIterations?: number
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
