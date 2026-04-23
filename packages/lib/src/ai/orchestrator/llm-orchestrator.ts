// packages/lib/src/ai/orchestrator/llm-orchestrator.ts

import type { Database } from '@auxx/database'
import { createScopedLogger, type Logger } from '@auxx/logger'
import { UsageLimitError } from '../../errors'
import { createUsageGuard } from '../../usage/create-usage-guard'
import type { LLMClient } from '../clients/base/llm-client'
import type {
  LLMInvokeParams,
  LLMResponse,
  LLMStreamChunk,
  LLMStreamResult,
  ToolCall,
  UsageMetrics,
} from '../clients/base/types'
import { QuotaExceededError } from '../errors/quota-errors'
import { ProviderManager } from '../providers/provider-manager'
import { ProviderRegistry } from '../providers/provider-registry'
import { ModelType } from '../providers/types'
import { QuotaService } from '../quota/quota-service'
import type {
  AICallbacks,
  BatchLLMRequest,
  BatchLLMResponse,
  LLMInvocationRequest,
  LLMInvocationResponse,
  OrchestratorConfig,
  ToolExecutionResult,
  ToolExecutor,
  UsageSource,
  UsageTrackingService,
} from './types'
import { OrchestratorError, ToolExecutionError } from './types'

/**
 * Universal LLM Orchestrator for all AI operations across the application
 * Provides unified interface for LLM invocation with callbacks, tool execution, and usage tracking
 */
export class LLMOrchestrator {
  private logger: Logger
  private config: OrchestratorConfig

  constructor(
    private usageService?: UsageTrackingService,
    private db?: Database,
    config?: Partial<OrchestratorConfig>,
    logger?: Logger
  ) {
    this.logger = logger || createScopedLogger('LLMOrchestrator')
    this.config = {
      enableUsageTracking: true,
      enableQuotaEnforcement: true,
      defaultTimeouts: {
        request: 120000, // 2 minutes
        streaming: 300000, // 5 minutes
      },
      retryDefaults: {
        maxAttempts: 3,
        backoffStrategy: 'exponential',
      },
      ...config,
    }
  }

  /**
   * Universal LLM invocation - usable in workflows, APIs, background jobs, webhooks
   */
  async invoke(request: LLMInvocationRequest): Promise<LLMInvocationResponse> {
    const { model, provider, messages, parameters, organizationId, userId, context } = request

    this.logger.debug('LLM invocation started', {
      provider,
      model,
      organizationId,
      userId,
      messageCount: messages.length,
      context: context?.source,
    })

    const startTime = Date.now()

    try {
      // Single-pass gate: resolves the client + credential metadata AND enforces
      // the SYSTEM credit quota + abuse rate-limit. One DB lookup for client
      // credentials covers both.
      const {
        client: llmClient,
        providerType,
        credentialSource,
      } = await this.enforceQuotaGate(provider, model, organizationId, userId)

      // Execute callbacks - beforeInvoke
      await this.triggerBeforeCallback(request.callbacks, {
        provider,
        model,
        organizationId,
        userId,
        context,
      })

      // Build invocation parameters with enhanced features
      const invokeParams: LLMInvokeParams = {
        model,
        messages: await this.processMessages(messages, request.multiModal),
        parameters,
        tools: request.tools || [],
        stream: request.streaming?.enabled || false,
        response_format: request.structuredOutput?.enabled ? 'json_schema' : undefined,
        json_schema: request.structuredOutput?.schema
          ? JSON.stringify(request.structuredOutput.schema)
          : undefined,
      }

      // Execute with streaming or direct invocation
      let response: LLMResponse
      if (request.streaming?.enabled) {
        response = await this.handleStreamingInvocation(llmClient, invokeParams, request.callbacks)
      } else {
        response = await llmClient.invoke(invokeParams)
      }

      // Execute tools if present and tool executor provided
      let toolResults: ToolExecutionResult[] | undefined
      if (response.tool_calls && response.tool_calls.length > 0 && request.toolExecutor) {
        toolResults = await this.executeTools(
          response.tool_calls,
          request.toolExecutor,
          context,
          request.callbacks
        )
      }

      // Parse structured output if enabled
      let structuredOutput: Record<string, any> | undefined
      if (request.structuredOutput?.enabled && response.content) {
        structuredOutput = this.parseStructuredOutput(
          response.content,
          request.structuredOutput.schema
        )
      }

      // Track usage with providerType for quota deduction
      if (this.config.enableUsageTracking && this.usageService && response.usage) {
        // Determine source from context
        const source = (context?.source as UsageSource) ?? 'other'
        const sourceId =
          context?.workflowId ?? context?.datasetId ?? context?.sessionId ?? undefined

        await this.usageService.trackUsage({
          organizationId,
          userId,
          provider,
          model,
          usage: response.usage,
          context: context?.source || 'unknown',
          timestamp: new Date(),
          metadata: {
            executionTime: Date.now() - startTime,
            hasTools: !!response.tool_calls?.length,
            hasStructuredOutput: !!structuredOutput,
          },
          // Pass provider type for quota tracking - SYSTEM providers decrement the credit pool.
          providerType,
          credentialSource,
          // creditsUsed is left undefined so UsageTrackingService resolves it
          // via the model credit multiplier (1/3/8 for small/medium/large tiers).
          source,
          sourceId,
        })
      }

      // Build final response
      const finalResponse: LLMInvocationResponse = {
        ...response,
        provider,
        tool_results: toolResults,
        structured_output: structuredOutput,
      }

      // Execute callbacks - afterInvoke
      await this.triggerAfterInvokeCallback(request.callbacks, finalResponse)

      this.logger.info('LLM invocation completed successfully', {
        provider,
        model,
        organizationId,
        executionTime: Date.now() - startTime,
        usage: response.usage,
        hasTools: !!toolResults?.length,
        hasStructuredOutput: !!structuredOutput,
      })

      return finalResponse
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      this.logger.error('LLM invocation failed', {
        error: errorMessage,
        provider,
        model,
        organizationId,
        userId,
        executionTime: Date.now() - startTime,
      })

      // Execute callbacks - onError
      await this.triggerInvokeErrorCallback(request.callbacks, error as Error)

      throw new OrchestratorError(
        `LLM invocation failed: ${errorMessage}`,
        'invoke',
        provider,
        model,
        error as Error
      )
    }
  }

  /**
   * Stream-specific invocation for real-time applications.
   *
   * **Usage tracking is the caller's responsibility.** Unlike `invoke()`, this
   * method does NOT call `UsageTrackingService.trackUsage` internally — the
   * generator's return value (`LLMInvocationResponse`) carries `usage`,
   * `providerType`, and `credentialSource`, and the caller must forward those
   * to `UsageTrackingService.trackUsage` or `trackUsageBatch` to (a) record
   * the `AiUsage` row and (b) deduct SYSTEM credits via `QuotaService`.
   *
   * The current callers (`agent-framework/llm-adapter.ts` → kopilot route +
   * `process-agent-job.ts`) batch usage per turn, which is cheaper than
   * per-chunk tracking inside the orchestrator. If you add a new direct
   * `streamInvoke` caller, do not skip this step or SYSTEM credits won't be
   * deducted.
   */
  async *streamInvoke(
    request: LLMInvocationRequest
  ): AsyncGenerator<LLMStreamChunk, LLMInvocationResponse> {
    const { model, provider, messages, parameters, organizationId, userId, context } = request

    this.logger.debug('LLM stream invocation started', {
      provider,
      model,
      organizationId,
      userId,
    })

    // Single-pass gate: resolves the client + credential metadata AND enforces
    // the SYSTEM credit quota + abuse rate-limit.
    const {
      client: llmClient,
      providerType,
      credentialSource,
    } = await this.enforceQuotaGate(provider, model, organizationId, userId)

    try {
      // Build invocation parameters
      const invokeParams: LLMInvokeParams = {
        model,
        messages: await this.processMessages(messages, request.multiModal),
        parameters,
        tools: request.tools || [],
        stream: true,
        ...(request.structuredOutput?.enabled && {
          response_format: 'json_schema' as const,
          json_schema: request.structuredOutput.schema
            ? JSON.stringify(request.structuredOutput.schema)
            : undefined,
        }),
      }

      // Stream the response, accumulating content in a single pass.
      // Use manual .next() iteration to capture the generator return value
      // which contains reasoning_content (not available on per-chunk deltas).
      const streamResult = llmClient.streamInvoke(invokeParams)
      let finalContent = ''
      let finalToolCalls: ToolCall[] = []
      let finalUsage: UsageMetrics | undefined
      let clientResult: LLMStreamResult | undefined

      while (true) {
        const { value: chunk, done } = await streamResult.next()
        if (done) {
          // Generator return value contains the final LLMStreamResult
          clientResult = chunk as LLMStreamResult | undefined
          break
        }

        // Trigger chunk callback
        await this.triggerNewChunkCallback(request.callbacks, chunk)

        // Accumulate final result from chunks
        finalContent += chunk.delta || ''
        if (chunk.toolCalls && chunk.toolCalls.length > 0) {
          finalToolCalls = chunk.toolCalls
        }
        if (chunk.usage) {
          finalUsage = chunk.usage
        }

        // Yield chunk to caller
        yield chunk
      }

      const finalResult: LLMStreamResult = clientResult ?? {
        model,
        content: finalContent,
        toolCalls: finalToolCalls,
        usage: finalUsage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }
      // Prefer accumulated content/toolCalls/usage from chunks (more reliable)
      finalResult.content = finalContent || finalResult.content
      finalResult.toolCalls = finalToolCalls.length > 0 ? finalToolCalls : finalResult.toolCalls
      finalResult.usage = finalUsage || finalResult.usage

      // Process final result similar to regular invoke
      let toolResults: ToolExecutionResult[] | undefined
      if (finalResult.toolCalls.length > 0 && request.toolExecutor) {
        toolResults = await this.executeTools(
          finalResult.toolCalls,
          request.toolExecutor,
          context,
          request.callbacks
        )
      }

      let structuredOutput: Record<string, any> | undefined
      if (request.structuredOutput?.enabled && finalResult.content) {
        structuredOutput = this.parseStructuredOutput(
          finalResult.content,
          request.structuredOutput.schema
        )
      }

      const finalResponse: LLMInvocationResponse = {
        id: `stream_${Date.now()}`,
        model: finalResult.model,
        content: finalResult.content,
        tool_calls: finalResult.toolCalls,
        usage: finalResult.usage,
        reasoning_content: finalResult.reasoning_content,
        metadata: finalResult.metadata,
        provider,
        tool_results: toolResults,
        structured_output: structuredOutput,
        providerType,
        credentialSource,
      }

      return finalResponse
    } catch (error) {
      await this.triggerInvokeErrorCallback(request.callbacks, error as Error)
      throw error
    }
  }

  /**
   * Get LLM client with credential metadata for quota tracking.
   * Returns client along with providerType and credentialSource.
   * Internal — callers should use {@link enforceQuotaGate} for end-to-end
   * prep (credentials + quota + rate-limit).
   */
  private async getClientWithMetadata(
    provider: string,
    model: string,
    organizationId: string,
    userId: string
  ): Promise<{
    client: LLMClient
    providerType: 'SYSTEM' | 'CUSTOM'
    credentialSource: 'SYSTEM' | 'CUSTOM' | 'MODEL_SPECIFIC' | 'LOAD_BALANCED'
  }> {
    const providerManager = new ProviderManager(this.db!, organizationId, userId)

    const credentials = await providerManager.getCurrentCredentials(
      provider,
      model,
      ModelType.LLM,
      false // Don't obfuscate - we need real credentials
    )

    // Create specialized LLM client
    const providerClient = await ProviderRegistry.createClient(provider, organizationId, userId)
    const llmClient = providerClient.getClient(ModelType.LLM, credentials.credentials) as LLMClient

    return {
      client: llmClient,
      providerType: credentials.providerType || 'CUSTOM',
      credentialSource: credentials.credentialSource || 'CUSTOM',
    }
  }

  /**
   * Get LLM client (backward compatibility)
   */
  async getClient(
    provider: string,
    model: string,
    organizationId: string,
    userId: string
  ): Promise<LLMClient> {
    const { client } = await this.getClientWithMetadata(provider, model, organizationId, userId)
    return client
  }

  /**
   * Batch processing for multiple requests
   */
  async batchInvoke(batchRequest: BatchLLMRequest): Promise<BatchLLMResponse> {
    const { requests, batchOptions = {} } = batchRequest
    const { maxConcurrency = 5, failFast = false, retryFailures = false } = batchOptions

    this.logger.info('Starting batch LLM invocation', {
      requestCount: requests.length,
      maxConcurrency,
      failFast,
    })

    const startTime = Date.now()
    const results: BatchLLMResponse['results'] = []

    // Process requests in batches with concurrency control
    for (let i = 0; i < requests.length; i += maxConcurrency) {
      const batch = requests.slice(i, i + maxConcurrency)
      const batchPromises = batch.map(async (request, batchIndex) => {
        const requestIndex = i + batchIndex

        try {
          const response = await this.invoke(request)
          return { success: true, response, requestIndex }
        } catch (error) {
          if (failFast) {
            throw error
          }
          return {
            success: false,
            error: error as Error,
            requestIndex,
          }
        }
      })

      const batchResults = await Promise.allSettled(batchPromises)

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value)
        } else {
          if (failFast) {
            throw result.reason
          }
          results.push({
            success: false,
            error: result.reason,
            requestIndex: results.length,
          })
        }
      }
    }

    // Retry failures if enabled
    if (retryFailures) {
      const failedResults = results.filter((r) => !r.success)

      if (failedResults.length > 0) {
        this.logger.info('Retrying failed requests', { count: failedResults.length })

        for (const failedResult of failedResults) {
          try {
            const retryResponse = await this.invoke(requests[failedResult.requestIndex])
            results[failedResult.requestIndex] = {
              success: true,
              response: retryResponse,
              requestIndex: failedResult.requestIndex,
            }
          } catch (error) {
            // Keep the original failure
          }
        }
      }
    }

    const successfulRequests = results.filter((r) => r.success).length
    const totalExecutionTime = Date.now() - startTime

    this.logger.info('Batch LLM invocation completed', {
      totalRequests: requests.length,
      successfulRequests,
      failedRequests: requests.length - successfulRequests,
      totalExecutionTime,
    })

    return {
      results,
      metadata: {
        totalRequests: requests.length,
        successfulRequests,
        failedRequests: requests.length - successfulRequests,
        totalExecutionTime,
      },
    }
  }

  /**
   * Get token count for messages
   */
  async getNumTokens(
    text: string,
    model: string,
    provider: string = 'openai',
    organizationId: string,
    userId: string
  ): Promise<number> {
    try {
      const llmClient = await this.getClient(provider, model, organizationId, userId)

      // Get credentials for the provider
      // const providerManager = new ProviderManager(this.db!, organizationId, userId)
      // const credentials = await providerManager.getCurrentCredentials(
      //   provider,
      //   model,
      //   ModelType.LLM
      // )

      // const providerClient = await ProviderRegistry.createClient(provider, organizationId, userId)
      // const llmClient = providerClient.getClient(
      //   ModelType.LLM,
      //   credentials.credentials
      // ) as LLMClient

      if (llmClient.getNumTokens) {
        return llmClient.getNumTokens(text, model)
      }

      // Fallback estimation
      return Math.ceil(text.length / 4)
    } catch (error) {
      this.logger.warn('Failed to calculate tokens, using estimation', { error })
      return Math.ceil(text.length / 4)
    }
  }

  // ===== PRIVATE METHODS =====

  /**
   * Prepare for an LLM invocation in a single pass:
   *   1. Fetch the LLM client + credential metadata (providerType / credentialSource).
   *   2. If `enableQuotaEnforcement` is on and the call is SYSTEM-credentialed,
   *      check the org's credit quota (monthly + admin-granted bonus pool).
   *      Throws {@link QuotaExceededError} when both pools are exhausted.
   *   3. Regardless of credential source, consume one unit of the
   *      `aiCompletions` abuse rate-limit. Throws {@link UsageLimitError} when
   *      the ceiling is hit.
   *
   * Returning the client from here avoids a double DB lookup — `getClientWithMetadata`
   * already tells us the providerType, so we don't need a separate
   * `ProviderPreference` + `ProviderConfiguration` read to gate the quota.
   */
  private async enforceQuotaGate(
    provider: string,
    model: string,
    organizationId: string,
    userId: string
  ): Promise<{
    client: LLMClient
    providerType: 'SYSTEM' | 'CUSTOM'
    credentialSource: 'SYSTEM' | 'CUSTOM' | 'MODEL_SPECIFIC' | 'LOAD_BALANCED'
  }> {
    const clientMeta = await this.getClientWithMetadata(provider, model, organizationId, userId)

    if (!this.config.enableQuotaEnforcement || !this.db) return clientMeta

    // Tier 1: SYSTEM credit quota.
    if (clientMeta.providerType === 'SYSTEM') {
      const quota = new QuotaService(this.db, organizationId)
      const status = await quota.getQuotaStatus()
      if (status && status.isExceeded) {
        throw new QuotaExceededError(
          "You're out of AI credits. They'll refill at the start of your next billing cycle.",
          {
            provider,
            quotaUsed: status.quotaUsed,
            quotaLimit: status.quotaLimit,
            bonusCredits: status.bonusCredits,
            resetsAt: status.quotaPeriodEnd,
          }
        )
      }
    }

    // Tier 2: abuse-prevention rate limit. Counts raw call rate, not credit cost.
    const guard = await createUsageGuard(this.db)
    if (guard) {
      const usageResult = await guard.consume(organizationId, 'aiCompletions', { userId })
      if (!usageResult.allowed) {
        throw new UsageLimitError({
          metric: 'aiCompletions',
          current: usageResult.current ?? 0,
          limit: usageResult.limit ?? 0,
          message:
            'AI request rate limit reached for this billing period. Please contact support if this is unexpected.',
        })
      }
    }

    return clientMeta
  }

  private async handleStreamingInvocation(
    llmClient: LLMClient,
    params: LLMInvokeParams,
    callbacks?: AICallbacks
  ): Promise<LLMResponse> {
    const chunks: LLMStreamChunk[] = []

    for await (const chunk of llmClient.streamInvoke(params)) {
      chunks.push(chunk)

      // Trigger chunk callback
      await this.triggerNewChunkCallback(callbacks, chunk)
    }

    // Combine chunks into final response (LLMClient provides this method)
    return (llmClient as any).combineStreamChunks(chunks)
  }

  private async processMessages(
    messages: any[],
    multiModal?: { enabled: boolean }
  ): Promise<any[]> {
    // Basic message processing - can be extended for multi-modal content
    return messages
  }

  private async executeTools(
    toolCalls: ToolCall[],
    toolExecutor: ToolExecutor,
    context?: any,
    callbacks?: AICallbacks
  ): Promise<ToolExecutionResult[]> {
    this.logger.debug('Executing tools', { toolCount: toolCalls.length })

    try {
      // Notify about tool calls
      for (const toolCall of toolCalls) {
        await this.triggerToolCallCallback(callbacks, toolCall)
      }

      // Execute tools
      const results = await toolExecutor.executeTools(toolCalls, context)

      // Notify about results
      for (const result of results) {
        await this.triggerToolResultCallback(callbacks, result)
      }

      return results
    } catch (error) {
      throw new ToolExecutionError(
        `Tool execution failed: ${(error as Error).message}`,
        'batch',
        'multiple',
        error as Error
      )
    }
  }

  private parseStructuredOutput(
    content: string,
    schema?: Record<string, any>
  ): Record<string, any> | undefined {
    try {
      const cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '')
      return JSON.parse(cleaned)
    } catch (error) {
      this.logger.warn('Failed to parse structured output as JSON', { content, error })
      return undefined
    }
  }

  // ===== CALLBACK METHODS =====

  private async triggerBeforeCallback(callbacks?: AICallbacks, context?: any): Promise<void> {
    if (callbacks?.beforeInvoke) {
      try {
        await callbacks.beforeInvoke(context)
      } catch (error) {
        this.logger.warn('beforeInvoke callback failed', { error })
      }
    }
  }

  private async triggerNewChunkCallback(
    callbacks?: AICallbacks,
    chunk?: LLMStreamChunk
  ): Promise<void> {
    if (callbacks?.onChunk) {
      try {
        await callbacks.onChunk(chunk)
      } catch (error) {
        this.logger.warn('onChunk callback failed', { error })
      }
    }
  }

  private async triggerAfterInvokeCallback(
    callbacks?: AICallbacks,
    response?: LLMInvocationResponse
  ): Promise<void> {
    if (callbacks?.afterInvoke) {
      try {
        await callbacks.afterInvoke(response)
      } catch (error) {
        this.logger.warn('afterInvoke callback failed', { error })
      }
    }
  }

  private async triggerInvokeErrorCallback(callbacks?: AICallbacks, error?: Error): Promise<void> {
    if (callbacks?.onError) {
      try {
        await callbacks.onError(error)
      } catch (callbackError) {
        this.logger.warn('onError callback failed', { callbackError })
      }
    }
  }

  private async triggerToolCallCallback(
    callbacks?: AICallbacks,
    toolCall?: ToolCall
  ): Promise<void> {
    if (callbacks?.onToolCall) {
      try {
        await callbacks.onToolCall(toolCall)
      } catch (error) {
        this.logger.warn('onToolCall callback failed', { error })
      }
    }
  }

  private async triggerToolResultCallback(
    callbacks?: AICallbacks,
    result?: ToolExecutionResult
  ): Promise<void> {
    if (callbacks?.onToolResult) {
      try {
        await callbacks.onToolResult(result)
      } catch (error) {
        this.logger.warn('onToolResult callback failed', { error })
      }
    }
  }
}
