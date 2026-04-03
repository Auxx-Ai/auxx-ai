// packages/lib/src/ai/clients/base/llm-client.ts

import { TokenCalculator } from '../utils/token-calculator'
import { BaseSpecializedClient } from './base-specialized-client'
import type {
  ClientConfig,
  ContentType,
  LLMInvokeParams,
  LLMResponse,
  LLMStreamChunk,
  LLMStreamResult,
  Message,
  MultiModalContent,
  ProcessedContent,
  Tool,
  ToolCall,
  UsageMetrics,
} from './types'

/**
 * Abstract base class for LLM clients
 * Provides common LLM functionality like token calculation, streaming, and tool handling
 */
export abstract class LLMClient extends BaseSpecializedClient {
  // ===== FILE SUPPORT =====

  /**
   * MIME types that providers can process as file/document content blocks.
   * Images and audio are handled separately via their own ContentType.
   */
  static SUPPORTED_FILE_MIME_TYPES = [
    'application/pdf',
    'text/plain',
    'text/csv',
    'text/html',
    'text/markdown',
    'text/xml',
    'application/json',
    'application/xml',
  ] as const

  /**
   * Check if a MIME type is supported for file input.
   * Images route to 'image' ContentType, audio to 'audio', others checked against allowlist.
   */
  static isSupportedFileMimeType(mimeType: string): boolean {
    if (mimeType.startsWith('image/') || mimeType.startsWith('audio/')) return true
    return (
      (LLMClient.SUPPORTED_FILE_MIME_TYPES as readonly string[]).includes(mimeType) ||
      mimeType.startsWith('text/')
    )
  }

  /** Map MIME type to ContentType — images stay as 'image', audio as 'audio', rest as 'file'. */
  static mimeToContentType(mimeType: string): ContentType {
    if (mimeType.startsWith('image/')) return 'image'
    if (mimeType.startsWith('audio/')) return 'audio'
    return 'file'
  }

  /**
   * Convert base64 file data into a MultiModalContent block.
   * Determines content type from mimeType — images become 'image', everything else becomes 'file'.
   */
  static fileToMultiModalContent(
    base64Data: string,
    mimeType: string,
    filename?: string,
    size?: number
  ): MultiModalContent {
    if (!LLMClient.isSupportedFileMimeType(mimeType)) {
      throw new Error(
        `Unsupported file type: ${mimeType} (${filename ?? 'unknown'}). ` +
          `Supported types: ${LLMClient.SUPPORTED_FILE_MIME_TYPES.join(', ')}, image/*, audio/*`
      )
    }

    const type = LLMClient.mimeToContentType(mimeType)
    return {
      type,
      data: base64Data,
      metadata: { filename, mimeType, size },
    }
  }

  // ===== ABSTRACT METHODS (must be implemented by each provider) =====

  /**
   * Core LLM invocation
   */
  abstract invoke(params: LLMInvokeParams): Promise<LLMResponse>

  /**
   * Streaming LLM invocation
   */
  abstract streamInvoke(params: LLMInvokeParams): AsyncGenerator<LLMStreamChunk, LLMStreamResult>

  /**
   * Get base model name (useful for fine-tuned models)
   */
  abstract getBaseModel(model: string): string

  /**
   * Check if model is fine-tuned
   */
  abstract isFineTunedModel(model: string): boolean

  /**
   * Transform parameters for model-specific requirements
   */
  abstract transformParameters(params: LLMInvokeParams, model: string): LLMInvokeParams

  /**
   * Handle response format configuration
   */
  abstract handleResponseFormat(params: LLMInvokeParams): LLMInvokeParams

  /**
   * Calculate text tokens (provider-specific tokenization)
   */
  protected abstract calculateTextTokens(text: string, model?: string): number

  /**
   * Calculate multi-modal tokens (provider-specific)
   */
  protected abstract calculateMultiModalTokens(content: MultiModalContent[], model?: string): number

  // ===== IMPLEMENTED METHODS (common LLM functionality) =====

  /**
   * Multi-modal content processing (optional override)
   */
  async processMultiModalContent?(content: MultiModalContent[]): Promise<ProcessedContent>

  /**
   * Convert tools to provider-specific format (optional override)
   */
  convertToolsToProviderFormat?(tools: Tool[]): any[]

  /**
   * Extract tool calls from response (optional override)
   */
  extractToolCallsFromResponse?(response: any): ToolCall[]

  /**
   * Enhanced token calculation with multi-modal support
   */
  getNumTokens(content: string | MultiModalContent[], model?: string): number {
    if (typeof content === 'string') {
      return this.calculateTextTokens(content, model)
    }
    return this.calculateMultiModalTokens(content, model)
  }

  /**
   * Calculate tokens for complete request (messages + tools)
   */
  calculateRequestTokens(messages: Message[], tools?: Tool[], model?: string): number {
    let totalTokens = 0

    // Calculate message tokens
    for (const message of messages) {
      // Role overhead
      totalTokens += 4

      // Content tokens
      if (typeof message.content === 'string') {
        totalTokens += this.calculateTextTokens(message.content, model)
      } else if (Array.isArray(message.content)) {
        totalTokens += this.calculateMultiModalTokens(message.content, model)
      }
    }

    // Calculate tool tokens
    if (tools && tools.length > 0) {
      totalTokens += TokenCalculator.estimateToolsTokens(tools)
    }

    // Add base overhead for the request
    totalTokens += this.getRequestOverhead(model)

    return totalTokens
  }

  /**
   * Get request overhead for specific model
   */
  protected getRequestOverhead(model?: string): number {
    if (!model) return 10

    // Model-specific overheads
    if (model.includes('gpt-4')) return 30
    if (model.includes('claude')) return 25
    if (model.includes('gemini')) return 20

    return 10
  }

  /**
   * Filter unsupported features based on model capabilities
   * Universal method that all providers can use
   */
  protected filterUnsupportedFeatures(params: LLMInvokeParams): LLMInvokeParams {
    const processed = { ...params }

    // Get model capabilities from the registry (implement getModelCapabilities in derived classes)
    const modelCapabilities = this.getModelCapabilitiesFromRegistry?.(params.model)

    // Filter tools if model doesn't support them
    if (processed.tools?.length && modelCapabilities?.supports?.toolCalling === false) {
      this.logger.warn('Tools not supported for this model, removing tools from request', {
        model: params.model,
        toolCount: processed.tools.length,
        toolNames: processed.tools.map((t) => t.function?.name).filter(Boolean),
      })
      delete processed.tools
    }

    // Filter structured output if model doesn't support it
    if (processed.response_format && modelCapabilities?.supports?.structured === false) {
      this.logger.warn('Structured output not supported for this model, removing response_format', {
        model: params.model,
        responseFormat: processed.response_format,
      })
      delete processed.response_format
      delete processed.json_schema
    }

    // Filter vision content if model doesn't support it
    if (processed.messages && modelCapabilities?.supports?.vision === false) {
      const hasVisionContent = processed.messages.some(
        (msg) =>
          Array.isArray(msg.content) && msg.content.some((content) => content.type === 'image')
      )

      if (hasVisionContent) {
        this.logger.warn('Vision not supported for this model, removing image content', {
          model: params.model,
        })

        // Remove image content from messages
        processed.messages = processed.messages.map((msg) => {
          if (Array.isArray(msg.content)) {
            const filteredContent = msg.content.filter((content) => content.type !== 'image')
            // Convert back to string if only text content remains
            if (filteredContent.length === 1 && filteredContent[0].type === 'text') {
              return { ...msg, content: filteredContent[0].data }
            }
            return { ...msg, content: filteredContent }
          }
          return msg
        })
      }
    }

    // Filter file content if model doesn't support it
    if (processed.messages && modelCapabilities?.supports?.fileInput === false) {
      const hasFileContent = processed.messages.some(
        (msg) =>
          Array.isArray(msg.content) && msg.content.some((content) => content.type === 'file')
      )

      if (hasFileContent) {
        this.logger.warn('File input not supported for this model, removing file content', {
          model: params.model,
        })

        processed.messages = processed.messages.map((msg) => {
          if (Array.isArray(msg.content)) {
            const filteredContent = msg.content.filter((content) => content.type !== 'file')
            if (filteredContent.length === 0) {
              return {
                ...msg,
                content: [
                  {
                    type: 'text' as const,
                    data: '[File content removed — model does not support file input]',
                  },
                ],
              }
            }
            if (filteredContent.length === 1 && filteredContent[0].type === 'text') {
              return { ...msg, content: filteredContent[0].data }
            }
            return { ...msg, content: filteredContent }
          }
          return msg
        })
      }
    }

    return processed
  }

  /**
   * Get model capabilities from registry (optional - providers should implement this)
   */
  protected getModelCapabilitiesFromRegistry?(model: string): any

  /**
   * Validate LLM parameters
   */
  protected validateLLMParams(params: LLMInvokeParams): void {
    this.validateRequiredParams(params, ['model', 'messages'])

    // Validate messages array
    if (!Array.isArray(params.messages) || params.messages.length === 0) {
      throw new Error('Messages must be a non-empty array')
    }

    // Validate message structure
    for (const [index, message] of params.messages.entries()) {
      // Assistant messages with tool_calls can have null/empty content
      const hasToolCalls = message.role === 'assistant' && message.tool_calls?.length
      if (!message.role || (!hasToolCalls && message.content == null)) {
        throw new Error(`Invalid message at index ${index}: role and content are required`)
      }

      if (!['system', 'user', 'assistant', 'tool'].includes(message.role)) {
        throw new Error(`Invalid message role at index ${index}: ${message.role}`)
      }
    }

    // Validate parameters if provided
    if (params.parameters) {
      this.validateModelParameters(params.parameters)
    }
  }

  /**
   * Validate model parameters
   */
  protected validateModelParameters(parameters: any): void {
    if (parameters.temperature !== undefined) {
      if (
        typeof parameters.temperature !== 'number' ||
        parameters.temperature < 0 ||
        parameters.temperature > 2
      ) {
        throw new Error('Temperature must be a number between 0 and 2')
      }
    }

    if (parameters.max_tokens !== undefined) {
      if (!Number.isInteger(parameters.max_tokens) || parameters.max_tokens <= 0) {
        throw new Error('max_tokens must be a positive integer')
      }
    }

    if (parameters.top_p !== undefined) {
      if (typeof parameters.top_p !== 'number' || parameters.top_p <= 0 || parameters.top_p > 1) {
        throw new Error('top_p must be a number between 0 and 1')
      }
    }
  }

  /**
   * Clean illegal prompt messages for specific models
   */
  protected clearIllegalPromptMessages(messages: Message[], model: string): Message[] {
    const baseModel = this.getBaseModel(model)

    // O1/O3 models don't support system messages
    if (baseModel.startsWith('o1') || baseModel.startsWith('o3')) {
      return messages.map((msg) => {
        if (msg.role === 'system') {
          return { ...msg, role: 'user' }
        }
        return msg
      })
    }

    return messages
  }

  /**
   * Check if messages contain multi-modal content
   */
  protected hasMultiModalContent(messages: Message[]): boolean {
    return messages.some((msg) => Array.isArray(msg.content))
  }

  /**
   * Extract final content from streaming chunks
   */
  protected combineStreamChunks(chunks: LLMStreamChunk[]): LLMResponse {
    let content = ''
    let toolCalls: ToolCall[] = []
    let usage: UsageMetrics | undefined
    let metadata: any = {}

    // Find the last chunk with usage information
    const lastChunk = chunks[chunks.length - 1]
    if (lastChunk?.usage) {
      usage = lastChunk.usage
    }

    // Combine content from all chunks
    for (const chunk of chunks) {
      content += chunk.delta || ''

      if (chunk.toolCalls) {
        toolCalls = chunk.toolCalls
      }

      if (chunk.metadata) {
        metadata = { ...metadata, ...chunk.metadata }
      }
    }

    return {
      model: lastChunk?.model || 'unknown',
      content,
      tool_calls: toolCalls,
      usage: usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      metadata,
    }
  }

  /**
   * Create tool call from function call (OpenAI compatibility)
   */
  protected createToolCallFromFunction(functionCall: {
    name?: string
    arguments?: string
  }): ToolCall {
    if (!functionCall.name) {
      throw new Error('Function call missing name')
    }

    return {
      id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'function',
      function: {
        name: functionCall.name,
        arguments: functionCall.arguments || '{}',
      },
    }
  }

  /**
   * Estimate completion tokens for request
   */
  protected estimateCompletionTokens(params: LLMInvokeParams): number {
    const maxTokens = params.parameters?.max_tokens || params.max_completion_tokens

    if (maxTokens) {
      return Math.min(maxTokens, 4096) // Reasonable default max
    }

    // Estimate based on prompt length
    const promptTokens = this.calculateRequestTokens(params.messages, params.tools, params.model)
    return Math.min(promptTokens * 0.5, 2048) // Rough estimate
  }
}
