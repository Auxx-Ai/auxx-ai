// packages/lib/src/workflow-engine/nodes/utils/ai-invocation-utils.ts

import type { Message, Tool } from '../../../ai/clients/base/types'
import type { LLMOrchestrator } from '../../../ai/orchestrator/llm-orchestrator'
import type {
  AICallbacks,
  LLMInvocationRequest,
  ToolExecutor,
} from '../../../ai/orchestrator/types'
import type { Workflow } from '../../core/types'

/**
 * Structured output configuration for AI invocations
 */
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
 * Options for invoking the LLM orchestrator
 */
export interface InvokeOrchestratorOptions {
  // Core parameters
  model: string
  provider: string
  messages: Message[]
  parameters: Record<string, any>

  // Context
  organizationId: string
  userId: string
  workflowId?: string
  nodeId: string
  source: string

  // Optional features
  tools?: Tool[]
  toolExecutor?: ToolExecutor
  structuredOutput?: StructuredOutputConfig
  callbacks?: AICallbacks
  workflow?: Workflow
}

/**
 * Standardized response from orchestrator invocation
 */
export interface InvokeOrchestratorResponse {
  content: string
  model: string
  provider: string
  structured_output?: Record<string, any>
  tool_calls?: Array<{
    id: string
    name: string
    arguments: Record<string, any>
  }>
  tool_results?: Array<{
    toolCallId: string
    toolName: string
    success: boolean
    output: Record<string, any>
    error?: string
    executionTime?: number
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/**
 * Centralized function to invoke the LLM orchestrator
 *
 * This provides a consistent interface for all AI nodes to interact with the orchestrator,
 * reducing duplication and ensuring proper usage tracking, tool execution, and structured
 * output handling.
 *
 * @param orchestrator - The LLM orchestrator instance
 * @param options - Invocation options
 * @returns Standardized response with content, metadata, and tool results
 * @throws Error if invocation fails
 */
export async function invokeOrchestrator(
  orchestrator: LLMOrchestrator,
  options: InvokeOrchestratorOptions
): Promise<InvokeOrchestratorResponse> {
  const {
    model,
    provider,
    messages,
    parameters,
    organizationId,
    userId,
    workflowId,
    nodeId,
    source,
    tools,
    toolExecutor,
    structuredOutput,
    callbacks,
  } = options

  // Build the invocation request
  const invocationRequest: LLMInvocationRequest = {
    model,
    provider,
    messages,
    parameters,
    organizationId,
    userId,
    context: {
      source,
      workflowId,
      nodeId,
    },
    tools,
    toolExecutor,
    callbacks,
    structuredOutput: structuredOutput?.enabled
      ? {
          enabled: true,
          schema: structuredOutput.schema,
        }
      : undefined,
  }

  // Invoke the orchestrator
  const response = await orchestrator.invoke(invocationRequest)

  // Format tool calls if present
  const formattedToolCalls = response.tool_calls?.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.function.name,
    arguments: toolCall.function.arguments,
  }))

  // Format tool results if present
  const formattedToolResults = response.tool_results?.map((result) => ({
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    success: result.success,
    output: result.output,
    error: result.error,
    executionTime: result.executionTime,
  }))

  // Return standardized response
  return {
    content: response.content,
    model: response.model,
    provider: response.provider,
    structured_output: response.structured_output,
    tool_calls: formattedToolCalls,
    tool_results: formattedToolResults,
    usage: response.usage,
  }
}

/**
 * Build invocation options from common AI node configuration
 * Helper function to reduce boilerplate when setting up orchestrator calls
 *
 * @param baseOptions - Base options that are common across all AI nodes
 * @param additionalOptions - Additional options specific to the node type
 * @returns Complete invocation options ready for invokeOrchestrator()
 */
export function buildInvocationOptions(
  baseOptions: {
    model: string
    provider: string
    messages: Message[]
    parameters: Record<string, any>
    organizationId: string
    userId: string
    nodeId: string
    source: string
    workflowId?: string
    callbacks?: AICallbacks
  },
  additionalOptions?: {
    tools?: Tool[]
    toolExecutor?: ToolExecutor
    structuredOutput?: StructuredOutputConfig
    workflow?: Workflow
  }
): InvokeOrchestratorOptions {
  return {
    ...baseOptions,
    ...additionalOptions,
  }
}
