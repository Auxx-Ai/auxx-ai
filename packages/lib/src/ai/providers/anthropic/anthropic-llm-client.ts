// packages/lib/src/ai/providers/anthropic/anthropic-llm-client.ts

import type Anthropic from '@anthropic-ai/sdk'
import type { Logger } from '../../../logger'
import { LLMClient } from '../../clients/base/llm-client'
import type {
  ClientConfig,
  LLMInvokeParams,
  LLMResponse,
  LLMStreamChunk,
  LLMStreamResult,
  Message,
  ModelCapabilities,
  MultiModalContent,
  Tool,
  ToolCall,
  UsageMetrics,
} from '../../clients/base/types'
import { InvalidParameterError } from '../../clients/base/types'
import { ANTHROPIC_MODELS } from './anthropic-defaults'

/**
 * Anthropic specialized LLM client implementation
 * Supports Claude models with streaming, tool calling, and vision capabilities
 */
export class AnthropicLLMClient extends LLMClient {
  constructor(
    private apiClient: Anthropic,
    config: ClientConfig,
    logger?: Logger
  ) {
    super(config, 'Anthropic-LLM', logger)
  }

  // ===== REQUIRED ABSTRACT METHOD IMPLEMENTATIONS =====

  async invoke(params: LLMInvokeParams): Promise<LLMResponse> {
    this.validateLLMParams(params)

    // Debug initial parameters
    this.logger.debug('Anthropic LLM invoke started', {
      model: params.model,
      messageCount: params.messages.length,
      messages: params.messages.map((m) => ({
        role: m.role,
        contentLength: typeof m.content === 'string' ? m.content.length : m.content?.length,
      })),
      hasTools: !!params.tools?.length,
    })

    const startTime = this.getTimestamp()
    const processedParams = await this.preprocessParams(params)

    this.logger.debug('After parameter transformation', {
      messageCount: processedParams.messages.length,
      messages: processedParams.messages.map((m) => ({
        role: m.role,
        contentLength: typeof m.content === 'string' ? m.content.length : m.content?.length,
      })),
    })

    this.logOperationStart('LLM invoke', {
      model: params.model,
      messageCount: params.messages.length,
      hasTools: !!params.tools?.length,
    })

    try {
      return await this.withRetryAndCircuitBreaker(
        async () => {
          return await this.handleDirectCompletion(processedParams)
        },
        {
          operation: 'llm_invoke',
          model: params.model,
        }
      )
    } catch (error) {
      this.handleApiError(error, 'invoke')
    } finally {
      this.logOperationSuccess('LLM invoke', this.getTimestamp() - startTime, {
        model: params.model,
      })
    }
  }

  async *streamInvoke(params: LLMInvokeParams): AsyncGenerator<LLMStreamChunk, LLMStreamResult> {
    this.validateLLMParams(params)

    const processedParams = await this.preprocessParams(params)

    this.logOperationStart('LLM stream invoke', {
      model: params.model,
      messageCount: params.messages.length,
      hasTools: !!params.tools?.length,
    })

    let fullContent = ''
    let chunkCount = 0
    const toolCalls: ToolCall[] = []
    let finalUsage: UsageMetrics | undefined

    try {
      const anthropicParams = this.buildAnthropicParams(processedParams, true)

      const stream = await this.apiClient.messages.create({
        ...anthropicParams,
        stream: true,
      })

      for await (const event of stream as any) {
        chunkCount++

        switch (event.type) {
          case 'content_block_delta':
            if (event.delta.type === 'text_delta') {
              const delta = event.delta.text
              fullContent += delta

              yield {
                id: `anthropic_${Date.now()}_${chunkCount}`,
                model: params.model,
                content: fullContent,
                delta,
                finishReason: null,
                toolCalls: [],
                metadata: {
                  chunkIndex: chunkCount,
                  totalLength: fullContent.length,
                  eventType: event.type,
                },
              }
            }
            break

          case 'content_block_start':
            if (event.content_block.type === 'tool_use') {
              // Start of a tool call
              const toolCall: ToolCall = {
                id: event.content_block.id,
                type: 'function',
                function: {
                  name: event.content_block.name,
                  arguments: '',
                },
              }
              toolCalls.push(toolCall)
            }
            break

          case 'content_block_stop':
            // Content block completed
            break

          case 'message_delta':
            if (event.usage) {
              finalUsage = this.convertAnthropicUsage(event.usage)
            }
            break

          case 'message_stop':
            // Stream complete
            break
        }
      }

      return {
        model: params.model,
        content: fullContent,
        toolCalls,
        usage: finalUsage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        metadata: {
          chunkCount,
          totalLength: fullContent.length,
          streamingCompleted: true,
        },
      }
    } catch (error) {
      this.handleApiError(error, 'streamInvoke')
      throw error
    }
  }

  getBaseModel(model: string): string {
    // Anthropic doesn't have fine-tuning yet, so model is always base model
    return model
  }

  isFineTunedModel(model: string): boolean {
    // Anthropic doesn't support fine-tuning yet
    return false
  }

  transformParameters(params: LLMInvokeParams, model: string): LLMInvokeParams {
    const processed = { ...params }

    // Ensure max_tokens is set (required by Anthropic)
    if (!processed.parameters?.max_tokens) {
      processed.parameters = processed.parameters || {}
      processed.parameters.max_tokens = 1024
    }

    // Limit max_tokens based on model capabilities
    const maxTokensForModel = this.getMaxTokensForModel(model)
    if (processed.parameters.max_tokens > maxTokensForModel) {
      processed.parameters.max_tokens = maxTokensForModel
    }

    // Handle temperature range (Anthropic: 0-1, some systems use 0-2)
    if (processed.parameters.temperature && processed.parameters.temperature > 1) {
      processed.parameters.temperature = Math.min(processed.parameters.temperature / 2, 1)
    }

    return processed
  }

  handleResponseFormat(params: LLMInvokeParams): LLMInvokeParams {
    let processed = { ...params }

    // Check if model supports structured output
    const modelConfig = ANTHROPIC_MODELS[params.model]
    const supportsStructured = modelConfig?.supports?.structured || false

    if (processed.response_format || processed.json_schema) {
      this.logger.debug('Processing structured output request', {
        model: params.model,
        supportsStructured,
        responseFormat: processed.response_format,
        hasJsonSchema: !!processed.json_schema,
      })

      if (supportsStructured) {
        // For models that support structured output, use enhanced instructions
        processed = this.handleStructuredOutputForSupportedModel(processed)
      } else {
        // For older models, use basic JSON instructions
        processed = this.handleJsonInstructionsForUnsupportedModel(processed)
      }

      // Always remove the OpenAI-specific parameters as Anthropic doesn't support them natively
      delete processed.response_format
      delete processed.json_schema
    }

    return processed
  }

  /**
   * Handle structured output for models that support it (Claude 3.5+)
   */
  private handleStructuredOutputForSupportedModel(params: LLMInvokeParams): LLMInvokeParams {
    const processed = { ...params }

    let structuredInstruction = ''

    if (params.response_format === 'json_schema' && params.json_schema) {
      // Handle JSON schema structured output
      try {
        const schema =
          typeof params.json_schema === 'string'
            ? JSON.parse(params.json_schema)
            : params.json_schema

        structuredInstruction = this.createSchemaBasedInstruction(schema)
      } catch (error) {
        this.logger.warn('Failed to parse JSON schema, falling back to basic JSON', {
          error: error.message,
          schema: params.json_schema,
        })
        structuredInstruction = this.createBasicJsonInstruction()
      }
    } else if (
      params.response_format === 'json_object' ||
      (typeof params.response_format === 'object' && params.response_format.type === 'json_object')
    ) {
      // Handle basic JSON object format
      structuredInstruction = this.createBasicJsonInstruction()
    } else if (typeof params.response_format === 'string') {
      // Handle string format specifications
      structuredInstruction = `\n\nIMPORTANT: Respond in ${params.response_format} format only. Do not include any explanatory text outside the requested format.`
    }

    // Inject instruction into system message or create one
    processed.messages = this.injectSystemInstruction(processed.messages, structuredInstruction)

    return processed
  }

  /**
   * Handle JSON instructions for models that don't support structured output
   */
  private handleJsonInstructionsForUnsupportedModel(params: LLMInvokeParams): LLMInvokeParams {
    const processed = { ...params }

    // Basic JSON instruction for older models
    const jsonInstruction = this.createBasicJsonInstruction()
    processed.messages = this.injectSystemInstruction(processed.messages, jsonInstruction)

    return processed
  }

  /**
   * Create comprehensive JSON instruction based on schema
   */
  private createSchemaBasedInstruction(schema: any): string {
    let instruction = '\n\nIMPORTANT RESPONSE FORMAT REQUIREMENTS:\n'
    instruction += '- Respond with valid JSON only, no other text before or after\n'
    instruction += '- Follow this exact JSON schema:\n\n'
    instruction += '```json\n' + JSON.stringify(schema, null, 2) + '\n```\n\n'

    if (schema.properties) {
      instruction += 'Required properties:\n'
      Object.entries(schema.properties).forEach(([key, value]: [string, any]) => {
        const required = schema.required?.includes(key) ? ' (REQUIRED)' : ' (optional)'
        const type = value.type || 'any'
        const description = value.description ? ` - ${value.description}` : ''
        instruction += `- ${key}: ${type}${required}${description}\n`
      })
    }

    instruction += '\nEnsure your response is valid JSON that can be parsed directly.'

    return instruction
  }

  /**
   * Create basic JSON instruction
   */
  private createBasicJsonInstruction(): string {
    return (
      '\n\nIMPORTANT: Respond with valid JSON only, no other text. ' +
      'Ensure your response can be parsed as JSON directly without any additional formatting or explanations.'
    )
  }

  /**
   * Inject instruction into system message or create new system message
   */
  private injectSystemInstruction(messages: Message[], instruction: string): Message[] {
    const systemMessageIndex = messages.findIndex((msg) => msg.role === 'system')

    if (systemMessageIndex >= 0) {
      // Update existing system message
      const updatedMessages = [...messages]
      const systemMessage = updatedMessages[systemMessageIndex]

      updatedMessages[systemMessageIndex] = {
        ...systemMessage,
        content:
          typeof systemMessage.content === 'string'
            ? systemMessage.content + instruction
            : systemMessage.content, // For multi-modal content, we'd need more complex handling
      }

      return updatedMessages
    } else {
      // Create new system message at the beginning
      return [
        {
          role: 'system' as const,
          content: instruction.trim(),
        },
        ...messages,
      ]
    }
  }

  protected calculateTextTokens(text: string, model?: string): number {
    // Anthropic doesn't provide a tokenizer library like OpenAI
    // Use approximation: ~4 characters per token for Claude models
    return Math.ceil(text.length / 4)
  }

  protected calculateMultiModalTokens(content: MultiModalContent[], model?: string): number {
    let tokens = 0

    for (const item of content) {
      switch (item.type) {
        case 'text':
          tokens += this.calculateTextTokens(item.data, model)
          break

        case 'image':
          // Anthropic vision token calculation
          // Approximate: ~1600 tokens per image (varies by size)
          tokens += 1600
          break

        default:
          // Unknown content type
          tokens += 100
      }
    }

    return tokens
  }

  // ===== ANTHROPIC-SPECIFIC IMPLEMENTATION METHODS =====

  /**
   * Preprocess parameters with Anthropic-specific transformations
   * Follows the same pattern as OpenAI's preprocessParams
   */
  private async preprocessParams(params: LLMInvokeParams): Promise<LLMInvokeParams> {
    let processedParams: LLMInvokeParams = { ...params }

    // Get base model for transformations
    const baseModel = this.getBaseModel(params.model)

    // Model-specific transformations
    processedParams = this.transformParameters(processedParams, baseModel)

    // Filter out unsupported features based on model capabilities (with enhanced fallbacks)
    processedParams = this.filterUnsupportedFeaturesWithFallbacks(processedParams)

    // Handle response format (JSON schema, structured output)
    processedParams = this.handleResponseFormat(processedParams)

    // Process multi-modal content if present
    if (params.messages && this.hasMultiModalContent(params.messages)) {
      // Anthropic handles multi-modal content in message conversion
      // No additional preprocessing needed here
    }

    return processedParams
  }

  /**
   * Handle direct (non-streaming) completion
   */
  private async handleDirectCompletion(params: LLMInvokeParams): Promise<LLMResponse> {
    const anthropicParams = this.buildAnthropicParams(params, false)

    const completion = await this.apiClient.messages.create(anthropicParams)

    return this.convertAnthropicResponseToLLMResponse(completion)
  }

  /**
   * Build Anthropic API parameters from LLM invoke params
   */
  private buildAnthropicParams(params: LLMInvokeParams, stream: boolean = false): any {
    const { messages, tools, parameters } = params

    this.logger.debug('Building Anthropic API params', {
      model: params.model,
      messageCount: messages.length,
      hasTools: !!tools?.length,
      hasParameters: !!parameters,
    })

    // Convert messages to Anthropic format
    const { systemMessage, anthropicMessages } = this.convertMessagesToAnthropicFormat(messages)

    const anthropicParams: any = {
      model: params.model,
      max_tokens: parameters?.max_tokens || 1024,
      messages: anthropicMessages,
    }

    // Add system message if present
    if (systemMessage) {
      anthropicParams.system = systemMessage
    }

    // Add optional parameters
    if (parameters?.temperature !== undefined) {
      anthropicParams.temperature = parameters.temperature
    }

    if (parameters?.top_p !== undefined) {
      anthropicParams.top_p = parameters.top_p
    }

    // Add tools if present
    if (tools && tools.length > 0) {
      anthropicParams.tools = this.convertToolsToAnthropicFormat(tools)
    }

    this.logger.debug('Final Anthropic API params', {
      model: anthropicParams.model,
      messageCount: anthropicParams.messages.length,
      hasSystem: !!anthropicParams.system,
      hasTools: !!anthropicParams.tools?.length,
      maxTokens: anthropicParams.max_tokens,
    })

    return anthropicParams
  }

  /**
   * Convert unified message format to Anthropic format
   */
  private convertMessagesToAnthropicFormat(messages: Message[]): {
    systemMessage?: string
    anthropicMessages: any[]
  } {
    this.logger.debug('Converting messages to Anthropic format', {
      totalMessages: messages.length,
      messageRoles: messages.map((m) => m.role),
    })

    // Extract system messages (Anthropic handles these separately)
    const systemMessages = messages.filter((msg) => msg.role === 'system')
    let systemMessage =
      systemMessages.length > 0
        ? systemMessages
            .map((msg) =>
              typeof msg.content === 'string'
                ? msg.content
                : this.extractTextFromContent(msg.content)
            )
            .join('\n\n')
        : undefined

    // Process non-system messages
    const nonSystemMessages = messages.filter((msg) => msg.role !== 'system')

    this.logger.debug('Filtered messages', {
      systemMessageCount: systemMessages.length,
      nonSystemMessageCount: nonSystemMessages.length,
      nonSystemRoles: nonSystemMessages.map((m) => m.role),
    })

    // Convert to Anthropic format with proper role alternation
    const anthropicMessages = this.ensureRoleAlternation(
      nonSystemMessages.map((msg) => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: this.convertContentToAnthropicFormat(msg.content),
      }))
    )

    this.logger.debug('Final Anthropic messages', {
      messageCount: anthropicMessages.length,
      hasSystemMessage: !!systemMessage,
    })

    // Ensure we have at least one message
    if (anthropicMessages.length === 0) {
      this.logger.warn('No user/assistant messages found, handling edge case', {
        originalMessages: messages,
        systemMessageCount: systemMessages.length,
        hasSystemContent: !!systemMessage,
      })

      // Edge case: If we only have system messages, convert the first one to a user message
      // This handles cases where the calling code incorrectly uses "system" role for user prompts
      if (systemMessages.length > 0) {
        this.logger.info('Converting system message to user message as fallback')
        const firstSystemMessage = systemMessages[0]
        anthropicMessages.push({
          role: 'user',
          content: this.convertContentToAnthropicFormat(firstSystemMessage.content),
        })

        // Remove the converted message from system message if there were multiple
        if (systemMessages.length === 1) {
          systemMessage = undefined
        } else {
          // Keep remaining system messages as the system prompt
          systemMessage = systemMessages
            .slice(1)
            .map((msg) =>
              typeof msg.content === 'string'
                ? msg.content
                : this.extractTextFromContent(msg.content)
            )
            .join('\n\n')
        }
      } else {
        this.logger.error('No messages remaining after conversion', {
          originalMessages: messages,
          systemMessages: systemMessages,
          nonSystemMessages: nonSystemMessages,
        })
        throw new Error('No valid messages found for Anthropic API')
      }
    }

    return { systemMessage, anthropicMessages }
  }

  /**
   * Convert content to Anthropic format (supports multi-modal)
   */
  private convertContentToAnthropicFormat(content: string | MultiModalContent[]): any {
    if (typeof content === 'string') {
      return content
    }

    // Multi-modal content
    return content.map((item) => {
      switch (item.type) {
        case 'text':
          return { type: 'text', text: item.data }

        case 'image':
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: this.detectImageFormat(item.data),
              data: this.extractBase64Data(item.data),
            },
          }

        default:
          throw new InvalidParameterError(`Unsupported content type: ${item.type}`)
      }
    })
  }

  /**
   * Ensure proper role alternation required by Anthropic
   */
  private ensureRoleAlternation(messages: any[]): any[] {
    this.logger.debug('Ensuring role alternation', {
      inputCount: messages.length,
      inputRoles: messages.map((m) => m.role),
    })

    const result = []
    let lastRole = null

    for (const message of messages) {
      if (message.role === lastRole) {
        // Same role as previous - combine messages
        const lastMessage = result[result.length - 1]
        if (lastMessage) {
          this.logger.debug('Combining consecutive messages', {
            role: message.role,
            lastContentType: typeof lastMessage.content,
            currentContentType: typeof message.content,
          })
          // Combine content
          if (typeof lastMessage.content === 'string' && typeof message.content === 'string') {
            lastMessage.content += '\n\n' + message.content
          } else {
            // Convert to array format and combine
            const lastContent = Array.isArray(lastMessage.content)
              ? lastMessage.content
              : [{ type: 'text', text: lastMessage.content }]
            const currentContent = Array.isArray(message.content)
              ? message.content
              : [{ type: 'text', text: message.content }]
            lastMessage.content = [...lastContent, ...currentContent]
          }
        }
      } else {
        result.push(message)
        lastRole = message.role
      }
    }

    this.logger.debug('Role alternation complete', {
      outputCount: result.length,
      outputRoles: result.map((m) => m.role),
    })

    return result
  }

  /**
   * Convert tools to Anthropic format
   */
  private convertToolsToAnthropicFormat(tools: Tool[]): any[] {
    return tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: {
        type: 'object',
        properties: tool.function.parameters?.properties || {},
        required: tool.function.parameters?.required || [],
      },
    }))
  }

  /**
   * Convert Anthropic response to unified LLM response format
   */
  private convertAnthropicResponseToLLMResponse(response: any): LLMResponse {
    let content = ''
    const toolCalls: ToolCall[] = []

    // Extract content and tool calls from response
    for (const contentBlock of response.content || []) {
      if (contentBlock.type === 'text') {
        content += contentBlock.text
      } else if (contentBlock.type === 'tool_use') {
        toolCalls.push({
          id: contentBlock.id,
          type: 'function',
          function: {
            name: contentBlock.name,
            arguments: JSON.stringify(contentBlock.input),
          },
        })
      }
    }

    return {
      id: response.id,
      model: response.model,
      content,
      tool_calls: toolCalls,
      usage: this.convertAnthropicUsage(response.usage),
      metadata: {
        stopReason: response.stop_reason,
        stopSequence: response.stop_sequence,
      },
    }
  }

  /**
   * Convert Anthropic usage to unified format
   */
  private convertAnthropicUsage(usage: any): UsageMetrics {
    return {
      prompt_tokens: usage.input_tokens || 0,
      completion_tokens: usage.output_tokens || 0,
      total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
    }
  }

  /**
   * Get maximum tokens supported by model
   */
  private getMaxTokensForModel(model: string): number {
    const modelConfig = ANTHROPIC_MODELS[model]
    return modelConfig?.maxTokens || 8192
  }

  /**
   * Detect image format from data URL
   */
  private detectImageFormat(imageData: string): string {
    if (imageData.startsWith('data:image/jpeg')) return 'image/jpeg'
    if (imageData.startsWith('data:image/png')) return 'image/png'
    if (imageData.startsWith('data:image/webp')) return 'image/webp'
    if (imageData.startsWith('data:image/gif')) return 'image/gif'
    return 'image/jpeg' // default
  }

  /**
   * Extract base64 data from data URL
   */
  private extractBase64Data(imageData: string): string {
    const base64Index = imageData.indexOf('base64,')
    return base64Index !== -1 ? imageData.slice(base64Index + 7) : imageData
  }

  /**
   * Extract text content from multi-modal content array
   */
  private extractTextFromContent(content: MultiModalContent[]): string {
    return content
      .filter((item) => item.type === 'text')
      .map((item) => item.data)
      .join(' ')
  }

  /**
   * Handle API errors with Anthropic-specific error parsing
   */
  protected handleApiError(error: any, operation: string): never {
    this.logOperationError(operation, error)

    if (error?.error?.type) {
      switch (error.error.type) {
        case 'authentication_error':
          throw new Error('Invalid Anthropic API key')
        case 'permission_error':
          throw new Error('Insufficient permissions for Anthropic API')
        case 'rate_limit_error':
          throw new Error('Anthropic API rate limit exceeded')
        case 'invalid_request_error':
          throw new InvalidParameterError(`Invalid request: ${error.error.message}`)
        default:
          throw new Error(`Anthropic API Error: ${error.error.message}`)
      }
    }

    throw new Error(`Unknown Anthropic error in ${operation}: ${error.message || error}`)
  }

  /**
   * Get model capabilities from registry
   */
  protected getModelCapabilitiesFromRegistry(model: string): ModelCapabilities | undefined {
    const modelConfig = ANTHROPIC_MODELS[model]
    if (!modelConfig) return undefined

    return {
      maxTokens: modelConfig.maxTokens,
      supportsStreaming: modelConfig.supports.streaming,
      supportsTools: modelConfig.supports.toolCalling,
      supportedContentTypes: this.getSupportedContentTypes(model),
      costPerToken: modelConfig.costPer1kTokens
        ? {
            input: modelConfig.costPer1kTokens.input / 1000,
            output: modelConfig.costPer1kTokens.output / 1000,
          }
        : undefined,
      rateLimit: {
        requestsPerMinute: 100, // Anthropic default
        tokensPerMinute: 40000,
      },
    }
  }

  /**
   * Enhanced feature filtering with intelligent fallbacks
   * Provides better user experience when features are unsupported
   */
  private filterUnsupportedFeaturesWithFallbacks(params: LLMInvokeParams): LLMInvokeParams {
    const processed = { ...params }
    const modelConfig = ANTHROPIC_MODELS[params.model]

    if (!modelConfig) {
      this.logger.warn('Unknown model, using default capabilities', { model: params.model })
      return this.filterUnsupportedFeatures(processed)
    }

    // Filter tools if model doesn't support them
    if (processed.tools?.length && modelConfig.supports.toolCalling === false) {
      this.logger.warn('Tools not supported for this model, removing tools from request', {
        model: params.model,
        toolCount: processed.tools.length,
        toolNames: processed.tools.map((t) => t.function?.name).filter(Boolean),
      })
      delete processed.tools
    }

    // Enhanced structured output filtering with fallback
    if (
      (processed.response_format || processed.json_schema) &&
      modelConfig.supports.structured === false
    ) {
      this.logger.info(
        'Structured output not natively supported, will use JSON instructions instead',
        {
          model: params.model,
          responseFormat: processed.response_format,
          hasSchema: !!processed.json_schema,
        }
      )
      // Don't delete response_format here - let handleResponseFormat deal with it
      // It will provide fallback instructions for unsupported models
    }

    // Filter vision content if model doesn't support it
    if (processed.messages && modelConfig.supports.vision === false) {
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

    return processed
  }

  /**
   * Get supported content types for model
   */
  private getSupportedContentTypes(model: string): ('text' | 'image' | 'audio')[] {
    const modelConfig = ANTHROPIC_MODELS[model]
    const types: ('text' | 'image' | 'audio')[] = ['text']

    if (modelConfig?.supports.vision) {
      types.push('image')
    }

    return types
  }
}
