// packages/lib/src/ai/providers/openai/openai-llm-client.ts

import type { Logger } from '@auxx/logger'
import type OpenAI from 'openai'
import { LLMClient } from '../../clients/base/llm-client'
import {
  type ClientConfig,
  type FunctionCall,
  InvalidParameterError,
  type LLMInvokeParams,
  type LLMResponse,
  type LLMStreamChunk,
  type LLMStreamResult,
  type Message,
  type ModelCapabilities,
  type MultiModalContent,
  type ProcessedLLMParams,
  StreamingError,
  type Tool,
  type ToolCall,
  type UsageMetrics,
} from '../../clients/base/types'
import { TokenCalculator } from '../../clients/utils/token-calculator'
import { ModelConfigService } from '../../model-config-service'
import { ProviderRegistry } from '../provider-registry'

/** Extended delta type for providers that return reasoning_content (Kimi, DeepSeek, Qwen) */
interface ReasoningDelta {
  content?: string | null
  reasoning_content?: string | null
  tool_calls?: unknown[]
  role?: string
}

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
    ProviderRegistry.assertModelNotRetired(params.model)
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
    ProviderRegistry.assertModelNotRetired(params.model)
    this.validateLLMParams(params)

    const modelCapabilities = this.getModelCapabilitiesFromRegistry(params.model)
    if (modelCapabilities?.supports?.streaming === false) {
      throw new InvalidParameterError(`Streaming is not supported for model: ${params.model}`)
    }

    const processedParams = await this.preprocessParams(params)
    processedParams.stream = true

    this.logOperationStart('LLM stream invoke', {
      model: params.model,
      messageCount: params.messages.length,
    })

    let fullContent = ''
    let fullReasoningContent = ''
    let chunkCount = 0
    const toolCalls: ToolCall[] = []
    let functionCallBuffer: Partial<FunctionCall> | null = null
    const toolCallBuffers: Map<number, { id: string; name: string; arguments: string }> = new Map()
    let finalUsage: UsageMetrics | undefined
    let finished = false

    try {
      // Flatten parameters object to top level for OpenAI API
      // Spread order matters: restParams may contain response_format from handleResponseFormat,
      // so it must come AFTER parameters to avoid model defaults overwriting structured output config
      const { parameters, ...restParams } = processedParams
      const flattenedParams = {
        ...parameters, // Spread parameters (model defaults) first
        ...restParams, // Then overlay rest (includes response_format from handleResponseFormat)
        stream: true,
        stream_options: { include_usage: true },
      }

      // Strip internal-only params that are not part of the OpenAI Chat Completions API
      delete flattenedParams.verbosity

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

      this.logger.debug('OpenAI API streaming request', {
        model: flattenedParams.model,
        keys: Object.keys(flattenedParams),
        hasResponseFormat: !!flattenedParams.response_format,
        responseFormatType:
          typeof flattenedParams.response_format === 'object'
            ? (flattenedParams.response_format as any)?.type
            : flattenedParams.response_format,
      })

      const stream = await this.createWithReasoningFallback(flattenedParams, (payload) =>
        this.apiClient.chat.completions.create(payload as any)
      )

      for await (const chunk of stream) {
        // Handle usage information (may arrive after finish_reason in a separate chunk)
        if (chunk.usage) {
          finalUsage = this.convertUsage(chunk.usage)
          // If we already finished, skip further processing
          if (finished) continue
        }

        if (chunk.choices.length === 0) continue

        const delta = chunk.choices[0]
        const typedDelta = delta.delta as ReasoningDelta
        const deltaContent = typedDelta.content || ''
        const deltaReasoningContent = typedDelta.reasoning_content || ''
        const deltaFunctionCall = delta.delta.function_call
        const deltaToolCalls = (delta.delta as any).tool_calls as
          | Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>
          | undefined
        const finishReason = delta.finish_reason

        fullContent += deltaContent
        fullReasoningContent += deltaReasoningContent

        // Handle modern tool_calls streaming (OpenAI streams tool calls as indexed deltas)
        if (deltaToolCalls) {
          for (const tc of deltaToolCalls) {
            const existing = toolCallBuffers.get(tc.index)
            if (existing) {
              existing.arguments += tc.function?.arguments || ''
            } else {
              toolCallBuffers.set(tc.index, {
                id: tc.id || `call_${tc.index}`,
                name: tc.function?.name || '',
                arguments: tc.function?.arguments || '',
              })
            }
          }
          if (!finishReason) continue
        }

        // Handle legacy function_call streaming
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

        // Flush tool call buffers on finish
        if (finishReason && toolCallBuffers.size > 0) {
          for (const [, buf] of toolCallBuffers) {
            toolCalls.push({
              id: buf.id,
              type: 'function',
              function: { name: buf.name, arguments: buf.arguments },
            })
          }
          toolCallBuffers.clear()
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
          reasoning_delta: deltaReasoningContent || undefined,
          metadata: {
            chunkIndex: ++chunkCount,
            totalLength: fullContent.length,
            systemFingerprint: chunk.system_fingerprint,
          },
        }

        // Mark as finished but don't break — let the outer loop naturally consume
        // any remaining chunks (e.g. usage data sent after finish_reason).
        // A nested for-await on the same stream fails on some OpenAI-compatible
        // providers (Kimi) with "Cannot iterate over a consumed stream".
        if (finishReason) {
          finished = true
        }
      }
    } catch (error) {
      this.logger.error('Streaming error:', error)
      throw new StreamingError(`OpenAI streaming failed: ${(error as Error).message}`, error)
    }

    // Calculate final usage if not provided (fallback estimation)
    if (!finalUsage) {
      const promptTokens = this.calculateRequestTokens(params.messages, params.tools, params.model)
      const completionTokens = this.calculateTextTokens(fullContent, params.model)
      finalUsage = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      }
    }

    // Yield a usage-only chunk so consumers using for-await (which discards
    // the generator return value) still receive the usage data
    if (finalUsage && finalUsage.total_tokens > 0) {
      yield {
        id: `usage_${Date.now()}`,
        model: params.model,
        content: '',
        delta: '',
        finishReason: null,
        toolCalls: undefined,
        usage: finalUsage,
        metadata: {
          chunkIndex: ++chunkCount,
          totalLength: fullContent.length,
        },
      }
    }

    return {
      model: params.model,
      content: fullContent,
      toolCalls,
      usage: finalUsage,
      reasoning_content: fullReasoningContent || undefined,
      metadata: {
        chunkCount,
        totalLength: fullContent.length,
        streamingCompleted: true,
      },
    }
  }

  private async handleDirectCompletion(params: ProcessedLLMParams): Promise<LLMResponse> {
    // Flatten parameters object to top level for OpenAI API
    // Spread order matters: restParams may contain response_format from handleResponseFormat,
    // so it must come AFTER parameters to avoid model defaults overwriting structured output config
    const { parameters, ...restParams } = params
    const flattenedParams = {
      ...parameters, // Spread parameters (model defaults) first
      ...restParams, // Then overlay rest (includes response_format from handleResponseFormat)
    }

    // Strip internal-only params that are not part of the OpenAI Chat Completions API
    delete flattenedParams.verbosity

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

    this.logger.debug('OpenAI API request', {
      model: flattenedParams.model,
      keys: Object.keys(flattenedParams),
    })

    const completion = await this.createWithReasoningFallback(flattenedParams, (payload) =>
      this.apiClient.chat.completions.create(payload as any)
    )

    // Check for refusal (OpenAI structured outputs feature)
    const message = completion.choices[0]?.message as any
    if (message?.refusal) {
      throw new Error(`AI refused to generate output: ${message.refusal}`)
    }

    const content = message?.content || ''
    const reasoningContent = (message as ReasoningDelta)?.reasoning_content || ''
    const toolCalls = this.extractToolCallsFromOpenAIResponse(message)
    const usage = this.convertUsage(completion.usage)

    return {
      id: completion.id,
      model: completion.model,
      content,
      tool_calls: toolCalls,
      usage,
      reasoning_content: reasoningContent || undefined,
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
      this.logger.warn('Model not found in registry, dropping custom parameters', {
        model: params.model,
      })
    }

    // Handle fine-tuned models
    const baseModel = this.getBaseModel(params.model)

    // Model-specific transformations (O1/O3 handling) - keep for backward compatibility
    processedParams = this.transformParameters(processedParams, baseModel)

    // Apply model-specific parameter filtering using capabilities
    if (processedParams.parameters && modelCapabilities) {
      const originalParams = { ...processedParams.parameters }

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
        processedParams.parameters,
        { enforceRuleAllowlist: true }
      )

      // Log filtered parameters for debugging
      this.logger.debug('Filtered parameters for model', {
        model: params.model,
        droppedParams: Object.keys(originalParams).filter(
          (key) => processedParams.parameters?.[key] === undefined
        ),
        finalParamKeys: Object.keys(processedParams.parameters || {}),
        filteredParams: processedParams.parameters,
        isReasoningModel: ModelConfigService.isReasoningModel(modelCapabilities),
      })
    } else if (processedParams.parameters && Object.keys(processedParams.parameters).length > 0) {
      this.logger.warn('Unknown model, clearing custom parameters before OpenAI request', {
        model: params.model,
        droppedParams: Object.keys(processedParams.parameters),
      })
      processedParams.parameters = {}
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

    // Strip reasoning_content from messages — OpenAI doesn't support this field.
    // Subclasses that need reasoning_content override prepareReasoningContent().
    processedParams.messages = this.prepareReasoningContent(processedParams.messages)

    return processedParams
  }

  transformParameters(params: LLMInvokeParams, baseModel: string): LLMInvokeParams {
    const processed = { ...params }

    // O-series model specific handling (o1, o3, o4)
    if (baseModel.startsWith('o1') || baseModel.startsWith('o3') || baseModel.startsWith('o4')) {
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

      // Streaming is supported for current o1/o3 families, so no forced stream downgrade here.
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

    this.logger.debug('handleResponseFormat', {
      hasResponseFormat: !!params.response_format,
      responseFormatType: typeof params.response_format,
      responseFormatValue:
        typeof params.response_format === 'string'
          ? params.response_format
          : params.response_format
            ? 'object'
            : 'none',
      hasJsonSchema: !!params.json_schema,
    })

    if (params.response_format) {
      if (params.response_format === 'json_schema' && params.json_schema) {
        try {
          const rawSchema =
            typeof params.json_schema === 'string'
              ? JSON.parse(params.json_schema)
              : params.json_schema

          // Detect if schema is already in OpenAI wrapper format ({ name, schema, strict })
          // vs a plain JSON Schema ({ type: 'object', properties: ... })
          const isWrapped =
            rawSchema.schema && typeof rawSchema.schema === 'object' && !rawSchema.type
          const innerSchema = isWrapped ? rawSchema.schema : rawSchema

          // Older OpenAI chat models (gpt-4-turbo, gpt-4, gpt-3.5-turbo, gpt-4o-2024-05-13)
          // support JSON mode (`json_object`) but not strict Structured Outputs (`json_schema`).
          // Downgrade so recording/AI features still return parseable JSON on those models.
          if (!this.modelSupportsStrictJsonSchema(params.model)) {
            processed.messages = this.injectSchemaIntoSystemPrompt(processed.messages, innerSchema)
            processed.response_format = { type: 'json_object' }
            delete processed.json_schema
            this.logger.info(
              'Downgraded json_schema to json_object for model without strict schema support',
              {
                model: params.model,
              }
            )
            return processed
          }

          // OpenAI strict mode requires all properties to be in the required array
          const schemaForOpenAI = { ...innerSchema }
          if (schemaForOpenAI.properties && typeof schemaForOpenAI.properties === 'object') {
            // For strict mode, ensure all properties are required
            schemaForOpenAI.required = Object.keys(schemaForOpenAI.properties)
          }

          // GPT-5 and O-series models require additionalProperties: false at all levels
          // Recursively ensure this is set for all nested objects
          this.ensureAdditionalPropertiesFalse(schemaForOpenAI)

          // OpenAI requires the schema to be wrapped in a specific format
          const wrappedSchema = {
            name: rawSchema.name || innerSchema.name || 'output_schema',
            description:
              rawSchema.description || innerSchema.description || 'Generated output schema',
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
   * Whether a model supports strict Structured Outputs via `response_format: { type: 'json_schema' }`.
   * Pre-gpt-4o models (gpt-4-turbo, gpt-4, gpt-3.5-turbo) and the original gpt-4o-2024-05-13
   * only support legacy JSON mode (`json_object`), not strict schema enforcement.
   */
  private modelSupportsStrictJsonSchema(model: string): boolean {
    const base = this.getBaseModel(model)
    if (base === 'gpt-4o-2024-05-13') return false
    if (base.startsWith('gpt-4-turbo')) return false
    if (base === 'gpt-4' || base.startsWith('gpt-4-0')) return false
    if (base.startsWith('gpt-3.5')) return false
    return true
  }

  /**
   * Prepend a JSON schema description to the system message so `json_object` mode
   * still produces output matching the requested schema.
   */
  private injectSchemaIntoSystemPrompt(messages: Message[], schema: any): Message[] {
    const schemaText = `Respond with a single JSON object that strictly matches this JSON Schema. Do not include any prose, markdown, or code fences — only the JSON object.\n\nSchema:\n${JSON.stringify(schema, null, 2)}`

    const firstSystemIdx = messages.findIndex((m) => m.role === 'system')
    if (firstSystemIdx === -1) {
      return [{ role: 'system', content: schemaText }, ...messages]
    }

    return messages.map((msg, idx) => {
      if (idx !== firstSystemIdx) return msg
      const existing = typeof msg.content === 'string' ? msg.content : ''
      return { ...msg, content: existing ? `${existing}\n\n${schemaText}` : schemaText }
    })
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
        case 'file': {
          const size = item.metadata?.size ?? 0
          const mimeType = item.metadata?.mimeType ?? ''

          if (mimeType === 'application/pdf') {
            // OpenAI: text extraction + per-page image tokens (~850 tokens/page at low detail)
            const estimatedPages = Math.max(1, Math.ceil(size / 50_000))
            tokens += estimatedPages * 850
          } else if (mimeType.startsWith('text/')) {
            // Plain text: ~4 chars per token
            tokens += Math.ceil(size / 4)
          } else {
            tokens += 1000
          }
          break
        }
      }
    }

    return tokens
  }

  async getModelCapabilities(model: string): Promise<ModelCapabilities> {
    const baseModel = this.getBaseModel(model)
    const modelCaps = this.getModelCapabilitiesFromRegistry(baseModel)

    return {
      maxTokens: modelCaps?.contextLength ?? this.getMaxTokensForModel(baseModel),
      supportsStreaming: modelCaps?.supports.streaming ?? true,
      supportsTools: modelCaps?.supports.toolCalling ?? true,
      supportedContentTypes: this.getSupportedContentTypes(baseModel),
      costPerToken: await this.getCostPerToken(model),
      rateLimit: await this.getRateLimit(model),
    }
  }

  private getSupportedContentTypes(model: string): Array<'text' | 'image' | 'audio' | 'file'> {
    const baseTypes: Array<'text' | 'image' | 'audio' | 'file'> = ['text']

    const modelCaps = this.getModelCapabilitiesFromRegistry(model)

    if (modelCaps?.supports.vision || model.includes('vision')) {
      baseTypes.push('image')
    }

    if (modelCaps?.supports.fileInput) {
      baseTypes.push('file')
    }

    if (model.startsWith('gpt-4o-audio')) {
      baseTypes.push('audio')
    }

    return baseTypes
  }

  private getMaxTokensForModel(model: string): number {
    const modelCaps = this.getModelCapabilitiesFromRegistry(model)
    if (modelCaps?.contextLength) return modelCaps.contextLength

    // Fallback for unregistered models
    if (model.includes('gpt-4o')) return 128000
    if (model.includes('gpt-4-turbo')) return 128000
    if (model.includes('gpt-4')) return 8192
    if (model.includes('gpt-3.5-turbo')) return 16385

    return 4096
  }

  private async getCostPerToken(model: string): Promise<{ input: number; output: number }> {
    const baseModel = this.getBaseModel(model)
    const modelCaps = this.getModelCapabilitiesFromRegistry(baseModel)
    return modelCaps?.costPer1kTokens ?? { input: 0, output: 0 }
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
                  url:
                    item.data.startsWith('data:') || item.data.startsWith('http')
                      ? item.data
                      : `data:${item.metadata?.mimeType ?? 'image/png'};base64,${item.data}`,
                  detail: item.metadata?.detail || 'auto',
                },
              }
            case 'file':
              return {
                type: 'file',
                file: {
                  filename: item.metadata?.filename ?? 'document',
                  file_data: `data:${item.metadata?.mimeType ?? 'application/octet-stream'};base64,${item.data}`,
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

  /**
   * Prepare reasoning_content on messages before sending to the API.
   * Base implementation strips all reasoning_content (OpenAI doesn't support it).
   * Subclasses override to implement provider-specific strategies:
   * - Kimi: preserve all reasoning_content
   * - DeepSeek: keep only the last assistant's reasoning_content
   */
  protected prepareReasoningContent(messages: Message[]): Message[] {
    return messages.map((msg) => {
      if (msg.reasoning_content) {
        const { reasoning_content, ...rest } = msg
        return rest
      }
      return msg
    })
  }

  private shouldRetryWithoutReasoningParams(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return (
      message.includes('Unrecognized request argument supplied: reasoning_effort') ||
      message.includes("'reasoning_effort' does not support") ||
      message.includes('Function tools with reasoning_effort are not supported')
    )
  }

  private stripReasoningOnlyParams(params: Record<string, any>): Record<string, any> {
    const cleaned = { ...params }
    delete cleaned.reasoning_effort
    delete cleaned.verbosity
    return cleaned
  }

  private async createWithReasoningFallback<T>(
    params: Record<string, any>,
    requestFn: (requestParams: Record<string, any>) => Promise<T>
  ): Promise<T> {
    try {
      return await requestFn(params)
    } catch (error) {
      if (!this.shouldRetryWithoutReasoningParams(error) || params.reasoning_effort === undefined) {
        throw error
      }

      const retryParams = this.stripReasoningOnlyParams(params)
      this.logger.warn('Retrying OpenAI request without reasoning-only parameters', {
        model: params.model,
        removedParams: ['reasoning_effort', 'verbosity'],
      })
      return requestFn(retryParams)
    }
  }
}
