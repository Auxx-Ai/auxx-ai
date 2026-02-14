// packages/lib/src/ai/providers/openai/openai-llm-client.ts

import type { Logger } from '@auxx/logger'
import type OpenAI from 'openai'
import { LLMClient } from '../../clients/base/llm-client'
import type {
  ClientConfig,
  FunctionCall,
  LLMInvokeParams,
  LLMResponse,
  LLMStreamChunk,
  LLMStreamResult,
  Message,
  ModelCapabilities,
  MultiModalContent,
  ProcessedLLMParams,
  Tool,
  ToolCall,
  UsageMetrics,
} from '../../clients/base/types'
import { TokenCalculator } from '../../clients/utils/token-calculator'
import { ModelConfigService } from '../../model-config-service'
import { ProviderRegistry } from '../provider-registry'

/**
 * OpenAI specialized LLM client with production features
 */
export class OpenAILLMClient extends LLMClient {
  private tokenizer?: any // tiktoken encoding - lazy loaded

  constructor(
    private apiClient: OpenAI,
    config: ClientConfig,
    logger?: Logger
  ) {
    super(config, 'OpenAI-LLM', logger)
  }

  async invoke(params: LLMInvokeParams): Promise<LLMResponse> {
    this.validateLLMParams(params)

    const startTime = this.getTimestamp()
    const processedParams = await this.preprocessParams(params)

    this.logOperationStart('LLM invoke', {
      model: params.model,
      messageCount: params.messages.length,
      hasTools: !!params.tools?.length,
      streaming: processedParams.stream,
    })

    try {
      return await this.withRetryAndCircuitBreaker(
        async () => {
          if (processedParams.stream) {
            return await this.handleStreamingToCompletion(processedParams)
          } else {
            return await this.handleDirectCompletion(processedParams)
          }
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
    processedParams.stream = true

    this.logOperationStart('LLM stream invoke', {
      model: params.model,
      messageCount: params.messages.length,
    })

    let fullContent = ''
    let chunkCount = 0
    const toolCalls: ToolCall[] = []
    let functionCallBuffer: Partial<FunctionCall> | null = null
    let finalUsage: UsageMetrics | undefined

    try {
      // Flatten parameters object to top level for OpenAI API
      const { parameters, ...restParams } = processedParams
      const flattenedParams = {
        ...restParams,
        ...parameters, // Spread parameters to top level
        stream: true,
        stream_options: { include_usage: true },
      }

      // Remove tools key completely if empty (OpenAI doesn't accept empty tools for unsupported models)
      if (
        flattenedParams.tools &&
        (!Array.isArray(flattenedParams.tools) || flattenedParams.tools.length === 0)
      ) {
        delete flattenedParams.tools
      }

      // Handle response_format: OpenAI expects an object, not a string
      if (flattenedParams.response_format) {
        if (typeof flattenedParams.response_format === 'string') {
          // If it's "text", remove it (that's the default)
          if (flattenedParams.response_format === 'text') {
            delete flattenedParams.response_format
          } else {
            // Transform string to object format
            flattenedParams.response_format = { type: flattenedParams.response_format }
          }
        }
      }

      // Log full request for debugging
      this.logger.info('OpenAI API Streaming Request', {
        model: flattenedParams.model,
        request: JSON.stringify(flattenedParams, null, 2),
      })

      const stream = await this.apiClient.chat.completions.create(flattenedParams)

      for await (const chunk of stream) {
        // Handle usage information
        if (chunk.usage) {
          finalUsage = this.convertUsage(chunk.usage)
          continue
        }

        if (chunk.choices.length === 0) continue

        const delta = chunk.choices[0]
        const deltaContent = delta.delta.content || ''
        const deltaFunctionCall = delta.delta.function_call
        const finishReason = delta.finish_reason

        fullContent += deltaContent

        // Handle function call streaming (sophisticated buffer management)
        if (functionCallBuffer && deltaFunctionCall) {
          functionCallBuffer.arguments += deltaFunctionCall.arguments || ''
          if (!finishReason) continue

          const toolCall = this.createToolCallFromFunction(functionCallBuffer)
          toolCalls.push(toolCall)
          functionCallBuffer = null
        } else if (deltaFunctionCall) {
          functionCallBuffer = {
            name: deltaFunctionCall.name,
            arguments: deltaFunctionCall.arguments || '',
          }
          if (!finishReason) continue
        }

        // Yield chunk with enhanced metadata
        yield {
          id: chunk.id,
          model: chunk.model,
          content: deltaContent,
          delta: deltaContent,
          finishReason: finishReason,
          toolCalls: finishReason ? toolCalls : [],
          usage: finishReason ? finalUsage : undefined,
          metadata: {
            chunkIndex: ++chunkCount,
            totalLength: fullContent.length,
            systemFingerprint: chunk.system_fingerprint,
          },
        }

        if (finishReason) break
      }
    } catch (error) {
      this.logger.error('Streaming error:', error)
      throw new StreamingError(`OpenAI streaming failed: ${(error as Error).message}`, error)
    }

    // Calculate final usage if not provided
    if (!finalUsage) {
      const promptTokens = this.calculateRequestTokens(params.messages, params.tools, params.model)
      const completionTokens = this.calculateTextTokens(fullContent, params.model)
      finalUsage = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      }
    }

    return {
      model: params.model,
      content: fullContent,
      toolCalls,
      usage: finalUsage,
      metadata: {
        chunkCount,
        totalLength: fullContent.length,
        streamingCompleted: true,
      },
    }
  }

  private async handleDirectCompletion(params: ProcessedLLMParams): Promise<LLMResponse> {
    // Flatten parameters object to top level for OpenAI API
    const { parameters, ...restParams } = params
    const flattenedParams = {
      ...restParams,
      ...parameters, // Spread parameters to top level
    }

    // Remove tools key completely if empty (OpenAI doesn't accept empty tools for unsupported models)
    if (
      flattenedParams.tools &&
      (!Array.isArray(flattenedParams.tools) || flattenedParams.tools.length === 0)
    ) {
      delete flattenedParams.tools
    }

    // Handle response_format: OpenAI expects an object, not a string
    if (flattenedParams.response_format) {
      if (typeof flattenedParams.response_format === 'string') {
        // If it's "text", remove it (that's the default)
        if (flattenedParams.response_format === 'text') {
          delete flattenedParams.response_format
        } else {
          // Transform string to object format
          flattenedParams.response_format = { type: flattenedParams.response_format }
        }
      }
    }

    // Log full request for debugging
    this.logger.info('OpenAI API Request', {
      model: flattenedParams.model,
      request: JSON.stringify(flattenedParams, null, 2),
    })

    const completion = await this.apiClient.chat.completions.create(flattenedParams)

    // Check for refusal (OpenAI structured outputs feature)
    const message = completion.choices[0]?.message as any
    if (message?.refusal) {
      throw new Error(`AI refused to generate output: ${message.refusal}`)
    }

    const content = message?.content || ''
    const toolCalls = this.extractToolCallsFromOpenAIResponse(message)
    const usage = this.convertUsage(completion.usage)

    return {
      id: completion.id,
      model: completion.model,
      content,
      tool_calls: toolCalls,
      usage,
      metadata: {
        systemFingerprint: completion.system_fingerprint,
        finishReason: completion.choices[0]?.finish_reason,
      },
    }
  }

  private async handleStreamingToCompletion(params: ProcessedLLMParams): Promise<LLMResponse> {
    const chunks: LLMStreamChunk[] = []

    for await (const chunk of this.streamInvoke(params)) {
      chunks.push(chunk)
    }

    return this.combineStreamChunks(chunks)
  }

  private async preprocessParams(params: LLMInvokeParams): Promise<ProcessedLLMParams> {
    let processedParams: ProcessedLLMParams = { ...params }

    // Get full model capabilities from registry (includes parameterRestrictions)
    const modelCapabilities = this.getModelCapabilitiesFromRegistry(params.model)

    if (!modelCapabilities) {
      this.logger.warn('Model not found in registry, parameter filtering disabled', {
        model: params.model,
      })
    }

    // Handle fine-tuned models
    const baseModel = this.getBaseModel(params.model)

    // Model-specific transformations (O1/O3 handling) - keep for backward compatibility
    processedParams = this.transformParameters(processedParams, baseModel)

    // Apply model-specific parameter filtering using capabilities
    if (processedParams.parameters && modelCapabilities) {
      // First apply defaults
      processedParams.parameters = ModelConfigService.applyDefaults(
        modelCapabilities,
        processedParams.parameters
      )

      // Validate parameters against rules (type checking, options validation, etc.)
      processedParams.parameters = ModelConfigService.validateParameters(
        modelCapabilities,
        processedParams.parameters
      )

      // Then filter based on restrictions
      processedParams.parameters = ModelConfigService.filterParameters(
        modelCapabilities,
        processedParams.parameters
      )

      // Log filtered parameters for debugging
      this.logger.debug('Filtered parameters for model', {
        model: params.model,
        originalParams: params.parameters,
        filteredParams: processedParams.parameters,
        isReasoningModel: ModelConfigService.isReasoningModel(modelCapabilities),
      })
    }

    // Filter out unsupported features based on model capabilities
    processedParams = this.filterUnsupportedFeatures(processedParams)

    // Handle response format (JSON schema, structured output)
    processedParams = this.handleResponseFormat(processedParams)

    // Process multi-modal content
    if (params.messages && this.hasMultiModalContent(params.messages)) {
      processedParams.messages = await this.processMultiModalContentInternal(params.messages)
    }

    // Clean illegal prompt messages for specific models
    processedParams.messages = this.clearIllegalPromptMessages(processedParams.messages, baseModel)

    return processedParams
  }

  transformParameters(params: LLMInvokeParams, baseModel: string): LLMInvokeParams {
    const processed = { ...params }

    // O1/O3 model specific handling
    if (baseModel.startsWith('o1') || baseModel.startsWith('o3')) {
      // Transform max_tokens to max_completion_tokens
      if (processed.parameters?.max_tokens) {
        processed.max_completion_tokens = processed.parameters.max_tokens
        delete processed.parameters.max_tokens
      }

      // Remove stop sequences for O1 models
      delete processed.stop
      delete processed.parameters?.stop

      // Convert system messages to user messages
      processed.messages = processed.messages?.map((msg) => {
        if (msg.role === 'system') {
          return { ...msg, role: 'user' }
        }
        return msg
      })

      // Handle streaming for O1 models
      if (processed.stream && baseModel.match(/^o1(-\d{4}-\d{2}-\d{2})?$/)) {
        processed.block_as_stream = true
        processed.stream = false
      }
    }

    // GPT-5 model specific handling (already handled by ModelConfigService, but kept for explicit clarity)
    if (baseModel.startsWith('gpt-5') || baseModel.includes('gpt-5')) {
      // GPT-5 uses max_completion_tokens instead of max_tokens
      // This transformation is also handled by ModelConfigService.filterParameters
      // but we keep it here for backward compatibility
      if (processed.parameters?.max_tokens && !processed.parameters?.max_completion_tokens) {
        processed.parameters.max_completion_tokens = processed.parameters.max_tokens
        delete processed.parameters.max_tokens
      }
    }

    return processed
  }

  handleResponseFormat(params: LLMInvokeParams): LLMInvokeParams {
    const processed = { ...params }

    if (params.response_format) {
      if (params.response_format === 'json_schema' && params.json_schema) {
        try {
          const rawSchema =
            typeof params.json_schema === 'string'
              ? JSON.parse(params.json_schema)
              : params.json_schema
          // OpenAI strict mode requires all properties to be in the required array
          const schemaForOpenAI = { ...rawSchema }
          if (schemaForOpenAI.properties && typeof schemaForOpenAI.properties === 'object') {
            // For strict mode, ensure all properties are required
            schemaForOpenAI.required = Object.keys(schemaForOpenAI.properties)
          }

          // GPT-5 and O-series models require additionalProperties: false at all levels
          // Recursively ensure this is set for all nested objects
          this.ensureAdditionalPropertiesFalse(schemaForOpenAI)

          // OpenAI requires the schema to be wrapped in a specific format
          const wrappedSchema = {
            name: rawSchema.name || 'output_schema',
            description: rawSchema.description || 'Generated output schema',
            schema: schemaForOpenAI,
            strict: true,
          }

          processed.response_format = {
            type: 'json_schema',
            json_schema: wrappedSchema,
          }
          delete processed.json_schema
        } catch (error) {
          throw new InvalidParameterError(`Invalid JSON schema: ${params.json_schema}`)
        }
      } else if (typeof params.response_format === 'string') {
        processed.response_format = { type: params.response_format }
      }
    }

    return processed
  }

  /**
   * Recursively ensure all objects in a JSON schema have additionalProperties: false
   * This is required for OpenAI's strict mode in GPT-5 and O-series models
   *
   * @param schema - The JSON schema to process
   * @returns The processed schema with additionalProperties: false on all objects
   */
  private ensureAdditionalPropertiesFalse(schema: any): any {
    if (!schema || typeof schema !== 'object') {
      return schema
    }

    // If this is an object type, ensure additionalProperties is false
    if (schema.type === 'object') {
      if (schema.additionalProperties === undefined) {
        schema.additionalProperties = false
      }

      // Recursively process nested properties
      if (schema.properties && typeof schema.properties === 'object') {
        for (const key in schema.properties) {
          schema.properties[key] = this.ensureAdditionalPropertiesFalse(schema.properties[key])
        }
      }
    }

    // Handle arrays with object items
    if (schema.type === 'array' && schema.items) {
      schema.items = this.ensureAdditionalPropertiesFalse(schema.items)
    }

    // Handle oneOf, anyOf, allOf for complex schemas
    if (schema.oneOf) {
      schema.oneOf = schema.oneOf.map((s: any) => this.ensureAdditionalPropertiesFalse(s))
    }
    if (schema.anyOf) {
      schema.anyOf = schema.anyOf.map((s: any) => this.ensureAdditionalPropertiesFalse(s))
    }
    if (schema.allOf) {
      schema.allOf = schema.allOf.map((s: any) => this.ensureAdditionalPropertiesFalse(s))
    }

    return schema
  }

  getBaseModel(model: string): string {
    if (model.startsWith('ft:')) {
      return model.split(':')[1]
    }
    return model
  }

  isFineTunedModel(model: string): boolean {
    return model.startsWith('ft:')
  }

  protected calculateTextTokens(text: string, model?: string): number {
    // Use tiktoken for accurate tokenization if available
    if (this.tokenizer) {
      return this.tokenizer.encode(text).length
    }

    // Fallback to estimation
    return TokenCalculator.estimateTextTokens(text)
  }

  protected calculateMultiModalTokens(content: MultiModalContent[], model?: string): number {
    let tokens = 0

    for (const item of content) {
      switch (item.type) {
        case 'text':
          tokens += this.calculateTextTokens(item.data, model)
          break
        case 'image':
          // OpenAI vision token calculation
          tokens += item.metadata?.detail === 'high' ? 765 : 85
          break
        case 'audio':
          // Estimate based on duration
          tokens += Math.ceil((item.metadata?.duration || 30) / 10) * 50
          break
      }
    }

    return tokens
  }

  async getModelCapabilities(model: string): Promise<ModelCapabilities> {
    const baseModel = this.getBaseModel(model)

    return {
      maxTokens: this.getMaxTokensForModel(baseModel),
      supportsStreaming: true,
      supportsTools: !baseModel.startsWith('o1') && !baseModel.startsWith('o3'),
      supportedContentTypes: this.getSupportedContentTypes(baseModel),
      costPerToken: await this.getCostPerToken(model),
      rateLimit: await this.getRateLimit(model),
    }
  }

  private getSupportedContentTypes(model: string): Array<'text' | 'image' | 'audio'> {
    const baseTypes: Array<'text' | 'image' | 'audio'> = ['text']

    if (model.includes('vision') || model.startsWith('gpt-4o')) {
      baseTypes.push('image')
    }

    if (model.startsWith('gpt-4o-audio')) {
      baseTypes.push('audio')
    }

    return baseTypes
  }

  private getMaxTokensForModel(model: string): number {
    // OpenAI model context limits
    if (model.includes('gpt-4o')) return 128000
    if (model.includes('gpt-4-turbo')) return 128000
    if (model.includes('gpt-4')) return 8192
    if (model.includes('gpt-3.5-turbo')) return 16385
    if (model.startsWith('o1')) return 200000

    return 4096 // Default
  }

  private async getCostPerToken(model: string): Promise<{ input: number; output: number }> {
    // These would typically come from a pricing service
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-4o': { input: 0.0025, output: 0.01 },
      'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
      'gpt-4-turbo': { input: 0.01, output: 0.03 },
      'gpt-4': { input: 0.03, output: 0.06 },
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
    }

    const baseModel = this.getBaseModel(model)
    return pricing[baseModel] || { input: 0, output: 0 }
  }

  private async getRateLimit(
    model: string
  ): Promise<{ requestsPerMinute: number; tokensPerMinute: number }> {
    // Default OpenAI rate limits (would typically come from API or config)
    return {
      requestsPerMinute: 500,
      tokensPerMinute: 200000,
    }
  }

  private async processMultiModalContentInternal(messages: Message[]): Promise<Message[]> {
    // Process multi-modal content for OpenAI format
    return messages.map((message) => {
      if (Array.isArray(message.content)) {
        const openAIContent = message.content.map((item) => {
          switch (item.type) {
            case 'text':
              return { type: 'text', text: item.data }
            case 'image':
              return {
                type: 'image_url',
                image_url: {
                  url: item.data,
                  detail: item.metadata?.detail || 'auto',
                },
              }
            default:
              throw new Error(`Unsupported content type: ${item.type}`)
          }
        })

        return { ...message, content: openAIContent }
      }

      return message
    })
  }

  private extractToolCallsFromOpenAIResponse(message: any): ToolCall[] {
    if (!message.tool_calls) return []

    return message.tool_calls.map((call: any) => ({
      id: call.id,
      type: call.type,
      function: {
        name: call.function.name,
        arguments: call.function.arguments,
      },
    }))
  }

  private convertUsage(usage: any): UsageMetrics {
    return {
      prompt_tokens: usage?.prompt_tokens || 0,
      completion_tokens: usage?.completion_tokens || 0,
      total_tokens: usage?.total_tokens || 0,
    }
  }

  // Override tool conversion for OpenAI format
  convertToolsToProviderFormat(tools: Tool[]): any[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      },
    }))
  }

  extractToolCallsFromResponse(response: any): ToolCall[] {
    const message = response.choices?.[0]?.message
    return this.extractToolCallsFromOpenAIResponse(message)
  }

  /**
   * Get model capabilities from Provider Registry
   */
  protected getModelCapabilitiesFromRegistry(model: string): any {
    return ProviderRegistry.getModelCapabilities(model)
  }
}
