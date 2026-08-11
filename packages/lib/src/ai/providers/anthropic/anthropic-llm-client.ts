// packages/lib/src/ai/providers/anthropic/anthropic-llm-client.ts

import type Anthropic from '@anthropic-ai/sdk'
import { stripVendorKeywords } from '../../../json-schema/vendor'
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
import { ProviderRegistry } from '../provider-registry'
import { ANTHROPIC_MODELS } from './anthropic-defaults'

/**
 * Runtime default output cap applied when a caller doesn't set max_tokens.
 * 32K is the halfway mark for Sonnet 4.6 (64K ceiling) — enough headroom for
 * persona authoring + parallel tool_use turns, low enough to keep cost
 * predictable. Clamped per-model in transformParameters.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 32000

/**
 * Name of the synthetic tool used to enforce structured output. Anthropic's
 * documented reliable pattern for schema-conforming JSON is forced tool use:
 * define one tool whose `input_schema` is the requested schema and force it
 * via `tool_choice: { type: 'tool', name }` — the model must then emit a
 * `tool_use` block whose `input` conforms to the schema.
 */
export const STRUCTURED_OUTPUT_TOOL_NAME = 'emit_structured_output'

/**
 * Internal extension of LLMInvokeParams used to hand the forced-tool schema
 * from handleResponseFormat to buildAnthropicParams. Never sent to the API.
 */
type AnthropicInternalInvokeParams = LLMInvokeParams & {
  structuredOutputToolSchema?: Record<string, unknown>
}

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
    ProviderRegistry.assertModelNotRetired(params.model)
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
      const result = await this.withRetryAndCircuitBreaker(
        async () => {
          return await this.handleDirectCompletion(processedParams)
        },
        {
          operation: 'llm_invoke',
          model: params.model,
        },
        // A completion, streaming or not, gets the longer budget: reasoning
        // models are legitimately slow, and the embedding-sized `request`
        // timeout would fail calls that were about to succeed.
        { timeoutMs: this.config.timeouts.completion }
      )

      this.logOperationSuccess('LLM invoke', this.getTimestamp() - startTime, {
        model: params.model,
      })

      return result
    } catch (error) {
      this.handleApiError(error, 'invoke')
    }
  }

  async *streamInvoke(params: LLMInvokeParams): AsyncGenerator<LLMStreamChunk, LLMStreamResult> {
    ProviderRegistry.assertModelNotRetired(params.model)
    this.validateLLMParams(params)

    // Mark as streaming so handleResponseFormat never routes a stream through
    // the forced-tool structured-output path (streams keep prompt injection).
    const processedParams = await this.preprocessParams({ ...params, stream: true })

    this.logOperationStart('LLM stream invoke', {
      model: params.model,
      messageCount: params.messages.length,
      hasTools: !!params.tools?.length,
    })

    let fullContent = ''
    let chunkCount = 0
    const toolCalls: ToolCall[] = []
    let finalUsage: UsageMetrics | undefined
    let stopReason: string | undefined

    try {
      const anthropicParams = this.buildAnthropicParams(processedParams, true)

      const stream = await this.apiClient.messages.create({
        ...anthropicParams,
        stream: true,
      })

      let inputTokens = 0
      // Prompt-cache accounting arrives on message_start (reads/writes), not
      // message_delta. Capture both so the unified usage carries cache splits.
      let cachedInputTokens = 0
      let cacheWriteTokens = 0

      for await (const event of stream as any) {
        chunkCount++

        switch (event.type) {
          case 'message_start':
            // Capture input tokens from the initial message event
            if (event.message?.usage?.input_tokens) {
              inputTokens = event.message.usage.input_tokens
            }
            cachedInputTokens = event.message?.usage?.cache_read_input_tokens || 0
            cacheWriteTokens = event.message?.usage?.cache_creation_input_tokens || 0
            break

          case 'content_block_delta':
            if (event.delta.type === 'text_delta') {
              const delta = event.delta.text
              fullContent += delta

              yield {
                id: `anthropic_${Date.now()}_${chunkCount}`,
                model: params.model,
                content: fullContent,
                delta,
                toolCalls: [],
                metadata: {
                  chunkIndex: chunkCount,
                  totalLength: fullContent.length,
                  eventType: event.type,
                },
              }
            } else if (event.delta.type === 'input_json_delta') {
              // Accumulate streamed tool call arguments
              const lastToolCall = toolCalls[toolCalls.length - 1]
              if (lastToolCall) {
                lastToolCall.function.arguments += event.delta.partial_json
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
            // message_delta carries output_tokens AND stop_reason. Capture both so
            // truncation (`stop_reason === 'max_tokens'`) is visible downstream —
            // otherwise a mid-stream tool_use cut-off surfaces as silent empty args.
            if (event.usage) {
              const outputTokens = event.usage.output_tokens || 0
              finalUsage = {
                prompt_tokens: inputTokens,
                completion_tokens: outputTokens,
                total_tokens: inputTokens + outputTokens,
                cached_input_tokens: cachedInputTokens,
                cache_write_tokens: cacheWriteTokens,
              }
            }
            if (event.delta?.stop_reason) {
              stopReason = event.delta.stop_reason
            }
            break

          case 'message_stop':
            // Stream complete
            break
        }
      }

      // Warn when the response was truncated by the output cap. This is the
      // failure mode that turns a streamed `tool_use` into corrupt input_json
      // and surfaces downstream as empty args. Logging at warn so it's visible
      // without combing through delta events.
      if (stopReason === 'max_tokens') {
        const truncatedToolNames = toolCalls
          .filter(
            (tc) => typeof tc.function.arguments === 'string' && !isValidJson(tc.function.arguments)
          )
          .map((tc) => tc.function.name)
        this.logger.warn('Anthropic stream truncated by max_tokens', {
          model: params.model,
          requestedMaxTokens: (processedParams.parameters as any)?.max_tokens,
          outputTokens: finalUsage?.completion_tokens,
          contentLength: fullContent.length,
          toolCallCount: toolCalls.length,
          truncatedToolCalls: truncatedToolNames,
        })
      }

      // Yield a final chunk with tool calls and/or usage so for-await consumers
      // (e.g. the orchestrator) can see them — matching OpenAI client behavior.
      // finishReason mirrors Anthropic's stop_reason when available so callers
      // can detect truncation (`length` = OpenAI parlance for max_tokens hit).
      const finishReason =
        stopReason === 'max_tokens' ? 'length' : toolCalls.length > 0 ? 'tool_calls' : 'stop'
      yield {
        id: `anthropic_${Date.now()}_final`,
        model: params.model,
        content: fullContent,
        delta: '',
        finishReason,
        toolCalls,
        usage: finalUsage,
        metadata: {
          chunkIndex: ++chunkCount,
          totalLength: fullContent.length,
          eventType: toolCalls.length > 0 ? 'tool_calls_complete' : 'stream_complete',
          stopReason,
        },
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
          stopReason,
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

    // Ensure max_tokens is set (required by Anthropic). Default to 32K (half of
    // Sonnet 4.6's 64K ceiling), clamped at each model's actual maxTokens. The
    // previous hardcoded 1024 floor truncated streamed tool_use input mid-JSON
    // and surfaced downstream as empty args / "non-empty string" errors.
    const maxTokensForModel = this.getMaxTokensForModel(model)
    const runtimeDefault = Math.min(maxTokensForModel, DEFAULT_MAX_OUTPUT_TOKENS)
    if (!processed.parameters?.max_tokens) {
      processed.parameters = processed.parameters || {}
      processed.parameters.max_tokens = runtimeDefault
    } else if (processed.parameters.max_tokens > maxTokensForModel) {
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

      // Preferred path: enforce json_schema output via a forced synthetic
      // tool. Only when the request carries no user tools and isn't
      // streaming — tool-calling and streaming flows keep the legacy
      // prompt-injection behavior untouched.
      const forcedToolSchema = supportsStructured
        ? this.buildStructuredOutputToolSchema(processed)
        : undefined

      if (forcedToolSchema) {
        ;(processed as AnthropicInternalInvokeParams).structuredOutputToolSchema = forcedToolSchema
        this.logger.debug('Using forced tool-use for structured output', {
          model: params.model,
          tool: STRUCTURED_OUTPUT_TOOL_NAME,
        })
      } else if (supportsStructured) {
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
   * Decide whether a structured-output request qualifies for the forced
   * tool-use path and, if so, return the sanitized `input_schema` for the
   * synthetic tool. Returns undefined when the request must fall back to
   * prompt injection (user tools present, streaming, non-object schema, or
   * an unparseable schema).
   */
  private buildStructuredOutputToolSchema(
    params: LLMInvokeParams
  ): Record<string, unknown> | undefined {
    if (params.response_format !== 'json_schema' || !params.json_schema) return undefined
    // Tool-calling requests keep their own tools; don't mix in the synthetic
    // one (forcing it would suppress the user's tools entirely).
    if (params.tools && params.tools.length > 0) return undefined
    // Streaming keeps the prompt-injection path — the stream consumer treats
    // tool_use blocks as real tool calls, not as structured output.
    if (params.stream === true) return undefined

    const modelConfig = ANTHROPIC_MODELS[params.model]
    if (modelConfig?.supports?.toolCalling === false) return undefined

    let rawSchema: any
    try {
      rawSchema =
        typeof params.json_schema === 'string' ? JSON.parse(params.json_schema) : params.json_schema
    } catch {
      return undefined
    }
    if (!rawSchema || typeof rawSchema !== 'object') return undefined

    // Unwrap OpenAI-style `{ name, schema, strict }` wrappers to the inner
    // JSON Schema (mirrors openai-llm-client.handleResponseFormat).
    const isWrapped = rawSchema.schema && typeof rawSchema.schema === 'object' && !rawSchema.type
    const innerSchema = isWrapped ? rawSchema.schema : rawSchema

    // Drop editor-only `x-auxx` metadata before the schema reaches the API.
    const schema = stripVendorKeywords(innerSchema) as Record<string, unknown>

    // A tool's input_schema must be an object schema at the top level.
    const isObjectSchema =
      schema.type === 'object' || (schema.type === undefined && !!schema.properties)
    if (!isObjectSchema) return undefined

    return { ...schema, type: 'object' }
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
          error: error instanceof Error ? error.message : String(error),
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
  private createSchemaBasedInstruction(rawSchema: any): string {
    // Strip editor-only `x-auxx` metadata so it never reaches the prompt text.
    const schema = stripVendorKeywords(rawSchema) as any
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

      if (systemMessage) {
        updatedMessages[systemMessageIndex] = {
          ...systemMessage,
          content:
            typeof systemMessage.content === 'string'
              ? systemMessage.content + instruction
              : systemMessage.content, // For multi-modal content, we'd need more complex handling
        }
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

        case 'file': {
          const size = item.metadata?.size ?? 0
          const mimeType = item.metadata?.mimeType ?? ''

          if (mimeType === 'application/pdf') {
            // Anthropic: each page = text extraction + page image (~2000 tokens avg)
            const estimatedPages = Math.max(1, Math.ceil(size / 50_000))
            tokens += estimatedPages * 2000
          } else if (mimeType.startsWith('text/')) {
            // Plain text: ~4 chars per token
            tokens += Math.ceil(size / 4)
          } else {
            tokens += 1000
          }
          break
        }

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

    const structuredToolName = (params as AnthropicInternalInvokeParams).structuredOutputToolSchema
      ? STRUCTURED_OUTPUT_TOOL_NAME
      : undefined

    return this.convertAnthropicResponseToLLMResponse(completion, structuredToolName)
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

    // Add system message if present. Emit as an array of text blocks with
    // up-to-N ephemeral cache breakpoints so Anthropic caches the longest
    // common prefix across calls.
    //
    // If the system message contains `<!--auxx:cache-break-->` sentinels
    // (produced by the Kopilot prompt builder), each sentinel marks a tier
    // boundary — the block immediately BEFORE the sentinel gets a
    // `cache_control: ephemeral` marker. This buys multi-tier caching
    // (e.g. tier-1 static + tier-2 per-org) on the same prefix.
    //
    // If the system message has no sentinels, fall back to the legacy
    // single-block-with-single-breakpoint behaviour.
    if (systemMessage) {
      anthropicParams.system = buildSystemBlocks(systemMessage)
    }

    // Add optional sampling parameters, but only when the model accepts them.
    // Fable 5 / Opus 4.8 / Opus 4.7 remove temperature/top_p/top_k and 400 if
    // they're sent — strip anything the model lists in `unsupportedParams`.
    // This gate covers every caller (including the agent-framework summarizer's
    // hardcoded temperature: 0) since both invoke paths funnel through here.
    const modelConfig = ANTHROPIC_MODELS[params.model]
    const unsupportedParams = new Set(modelConfig?.parameterRestrictions?.unsupportedParams ?? [])

    if (parameters?.temperature !== undefined && !unsupportedParams.has('temperature')) {
      anthropicParams.temperature = parameters.temperature
    }

    if (parameters?.top_p !== undefined && !unsupportedParams.has('top_p')) {
      anthropicParams.top_p = parameters.top_p
    }

    // Add tools if present
    if (tools && tools.length > 0) {
      anthropicParams.tools = this.convertToolsToAnthropicFormat(tools)
    }

    // Forced tool-use structured output: register the synthetic tool with the
    // requested schema as input_schema and force it via tool_choice. Guarded
    // to non-streaming requests without user tools (both re-checked here so a
    // stray internal flag can never clobber real tool-calling or streaming).
    const structuredToolSchema = (params as AnthropicInternalInvokeParams)
      .structuredOutputToolSchema
    if (structuredToolSchema && !stream && !anthropicParams.tools) {
      anthropicParams.tools = [
        {
          name: STRUCTURED_OUTPUT_TOOL_NAME,
          description:
            'Record the final answer as structured JSON matching the required schema. ' +
            'Call this tool exactly once with the complete answer.',
          input_schema: structuredToolSchema,
        },
      ]
      anthropicParams.tool_choice = {
        type: 'tool',
        name: STRUCTURED_OUTPUT_TOOL_NAME,
        disable_parallel_tool_use: true,
      }
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
      nonSystemMessages.map((msg) => {
        // Tool result messages → Anthropic tool_result content block inside a user message
        if (msg.role === 'tool' && msg.tool_call_id) {
          return {
            role: 'user' as const,
            content: [
              {
                type: 'tool_result',
                tool_use_id: msg.tool_call_id,
                content:
                  typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
              },
            ],
          }
        }

        // Assistant messages with tool_calls → include tool_use content blocks
        if (msg.role === 'assistant' && msg.tool_calls?.length) {
          const content: any[] = []
          // Include any text content first
          if (msg.content && typeof msg.content === 'string' && msg.content.length > 0) {
            content.push({ type: 'text', text: msg.content })
          } else if (msg.content && Array.isArray(msg.content)) {
            content.push(...this.convertContentToAnthropicFormat(msg.content))
          }
          // Append tool_use blocks
          for (const tc of msg.tool_calls) {
            let input: Record<string, unknown> = {}
            try {
              input =
                typeof tc.function.arguments === 'string'
                  ? JSON.parse(tc.function.arguments)
                  : tc.function.arguments
            } catch {
              /* keep empty */
            }
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input,
            })
          }
          return { role: 'assistant' as const, content }
        }

        return {
          role: msg.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: this.convertContentToAnthropicFormat(msg.content),
        }
      })
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
          content: this.convertContentToAnthropicFormat(firstSystemMessage?.content ?? null),
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
  private convertContentToAnthropicFormat(content: string | MultiModalContent[] | null): any {
    // `Message.content` is nullable: an assistant turn that only carries
    // tool_calls has none. Those are handled by the tool_use branch above, but a
    // null-content message with no tool_calls still reaches here — return an
    // empty string rather than dereferencing null.
    if (content == null) {
      return ''
    }
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
              media_type: item.metadata?.mimeType || this.detectImageFormat(item.data),
              data: this.extractBase64Data(item.data),
            },
          }

        case 'file': {
          const mimeType = item.metadata?.mimeType ?? 'application/pdf'

          // Plain text files use Anthropic's text source type (no base64 needed)
          if (
            mimeType.startsWith('text/') ||
            mimeType === 'application/json' ||
            mimeType === 'application/xml'
          ) {
            return {
              type: 'document',
              source: {
                type: 'text',
                media_type: 'text/plain',
                data: Buffer.from(this.extractBase64Data(item.data), 'base64').toString('utf-8'),
              },
              cache_control: { type: 'ephemeral' },
            }
          }

          // PDFs and other binary docs use base64
          return {
            type: 'document',
            source: {
              type: 'base64',
              media_type: mimeType,
              data: this.extractBase64Data(item.data),
            },
            cache_control: { type: 'ephemeral' },
          }
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
   *
   * When `structuredToolName` is set (forced tool-use structured output), the
   * matching tool_use block is NOT surfaced as a tool call — its `input` IS
   * the structured answer. It's serialized into `content` so downstream
   * `JSON.parse(response.content)` consumers (orchestrator
   * parseStructuredOutput, workflow fallbacks) keep working unchanged.
   */
  private convertAnthropicResponseToLLMResponse(
    response: any,
    structuredToolName?: string
  ): LLMResponse {
    let content = ''
    const toolCalls: ToolCall[] = []
    let structuredOutput: Record<string, unknown> | undefined

    // Extract content and tool calls from response
    for (const contentBlock of response.content || []) {
      if (contentBlock.type === 'text') {
        content += contentBlock.text
      } else if (contentBlock.type === 'tool_use') {
        if (structuredToolName && contentBlock.name === structuredToolName) {
          structuredOutput = contentBlock.input
        } else {
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
    }

    if (structuredOutput !== undefined) {
      content = JSON.stringify(structuredOutput)
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
        ...(structuredOutput !== undefined && {
          structured_output: structuredOutput,
          structuredOutputTool: structuredToolName,
        }),
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
      // Anthropic's input_tokens already EXCLUDES cached reads; surface the cache
      // splits separately so we can measure hit rate and rate-limit-effective cost.
      cached_input_tokens: usage.cache_read_input_tokens || 0,
      cache_write_tokens: usage.cache_creation_input_tokens || 0,
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
  private extractTextFromContent(content: MultiModalContent[] | null): string {
    if (!content) return ''
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
            const onlyItem = filteredContent.length === 1 ? filteredContent[0] : undefined
            if (onlyItem?.type === 'text') {
              return { ...msg, content: onlyItem.data }
            }
            return { ...msg, content: filteredContent }
          }
          return msg
        })
      }
    }

    // Filter file content if model doesn't support it
    if (processed.messages && modelConfig.supports.fileInput === false) {
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
            const onlyItem = filteredContent.length === 1 ? filteredContent[0] : undefined
            if (onlyItem?.type === 'text') {
              return { ...msg, content: onlyItem.data }
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
  private getSupportedContentTypes(model: string): ('text' | 'image' | 'audio' | 'file')[] {
    const modelConfig = ANTHROPIC_MODELS[model]
    const types: ('text' | 'image' | 'audio' | 'file')[] = ['text']

    if (modelConfig?.supports.vision) {
      types.push('image')
    }

    if (modelConfig?.supports.fileInput) {
      types.push('file')
    }

    return types
  }
}

/**
 * Sentinel used by the Kopilot prompt builder to mark tier boundaries
 * inside a single system-message string. Kept verbatim here (not
 * imported) to avoid a downstream dependency from the Anthropic client
 * on Kopilot-specific code — any caller can use this string to signal
 * "split here and put a cache_control marker on the preceding block".
 *
 * Keep in sync with `packages/lib/src/ai/kopilot/prompts/sections/render.ts`.
 */
const CACHE_BREAK_SENTINEL = '<!--auxx:cache-break-->'

/** Anthropic allows up to 4 cache_control breakpoints per request. */
const MAX_CACHE_BREAKPOINTS = 4

/**
 * Convert a (possibly sentinel-bearing) system-message string into the
 * `system: [...]` array Anthropic expects.
 *
 * Without sentinels: one block, one cache breakpoint at the end (legacy
 * behaviour — caches the entire prompt).
 *
 * With sentinels: the sentinel count equals the desired number of cache
 * breakpoints. Segments are produced by splitting on the sentinel pattern;
 * the leading `min(sentinelCount, segments)` segments are marked with
 * `cache_control: ephemeral`. Anthropic caps total markers at 4.
 */
export function buildSystemBlocks(systemMessage: string): Array<{
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}> {
  if (!systemMessage.includes(CACHE_BREAK_SENTINEL)) {
    return [{ type: 'text', text: systemMessage, cache_control: { type: 'ephemeral' } }]
  }

  const sentinelCount = (
    systemMessage.match(new RegExp(escapeRegExp(CACHE_BREAK_SENTINEL), 'g')) ?? []
  ).length
  const segments = systemMessage
    .split(`\n\n${CACHE_BREAK_SENTINEL}\n\n`)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  const markerCount = Math.min(sentinelCount, segments.length, MAX_CACHE_BREAKPOINTS)
  return segments.map((text, i) => ({
    type: 'text' as const,
    text,
    cache_control: i < markerCount ? { type: 'ephemeral' as const } : undefined,
  }))
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Returns true iff `s` parses as JSON. Used to flag tool_use input that the
 * stream truncated mid-payload. */
function isValidJson(s: string): boolean {
  if (!s) return false
  try {
    JSON.parse(s)
    return true
  } catch {
    return false
  }
}
