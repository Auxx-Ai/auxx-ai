// packages/lib/src/ai/agent-framework/llm-adapter.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { ToolCall, UsageMetrics } from '../clients/base/types'
import { LLMOrchestrator } from '../orchestrator/llm-orchestrator'
import type { LLMInvocationRequest, UsageSource, UsageTrackingService } from '../orchestrator/types'
import { UsageTrackingService as DefaultUsageTrackingService } from '../usage/usage-tracking-service'
import type { LLMCallParams, LLMStreamEvent } from './types'

const logger = createScopedLogger('agent-llm')

export interface LLMAdapterConfig {
  organizationId: string
  userId: string
  db?: Database
  /** Overrides the default {@link DefaultUsageTrackingService} (DI seam for tests). */
  usageService?: UsageTrackingService
  /** `AiUsage.source` label for every call this adapter makes (default: 'agent'). */
  source?: UsageSource
  sourceId?: string
  /** Default false. Forwarded to LLMInvocationRequest.forceSystem. */
  forceSystem?: boolean
}

/**
 * Create a callModel function that wraps LLMOrchestrator streaming.
 * This is the only file in the agent framework that knows about provider details.
 *
 * **It is also where streamed LLM usage is metered.** `LLMOrchestrator.invoke`
 * records usage itself, but `streamInvoke` deliberately does not — it enforces
 * the quota gate, hands back `usage`/`providerType`/`credentialSource`, and
 * leaves recording to whoever consumed the stream. `streamInvoke` has exactly
 * one caller (this file), so metering here covers every agent path by
 * construction: kopilot, the agent worker, the customer chat widget, workflow
 * AI turns, evals, and the headless capture runners. Runners must not drain
 * usage themselves — that would double-bill.
 */
export function createCallModel(config: LLMAdapterConfig) {
  const orchestrator = new LLMOrchestrator(config.usageService, config.db)
  const usageService = config.usageService ?? new DefaultUsageTrackingService(config.db)
  const source: UsageSource = config.source ?? 'agent'

  return async function* callModel(params: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
    const { model, provider, messages, tools, parameters, responseFormat, signal } = params

    logger.info('Calling LLM', {
      model,
      provider,
      messageCount: messages.length,
      toolCount: tools?.length ?? 0,
      hasResponseFormat: !!responseFormat,
    })

    // Full message contents — info so they land in the per-session run log.
    // `toolCalls`/`toolCallId` are projected too: without them an assistant
    // message that DOES carry tool_calls reads as bare and the tool messages
    // after it read as orphaned, which makes the log actively misleading about
    // call/result pairing and ordering.
    logger.info('LLM messages', {
      model,
      messages: messages.map((m, i) => ({
        index: i,
        role: m.role,
        contentLength: m.content?.length ?? 0,
        content: typeof m.content === 'string' ? m.content : '[non-string content]',
        ...(m.tool_calls
          ? {
              toolCalls: m.tool_calls.map((c) => ({
                id: c.id,
                name: c.function?.name,
              })),
            }
          : {}),
        ...(m.tool_call_id ? { toolCallId: m.tool_call_id } : {}),
      })),
    })

    const request: LLMInvocationRequest = {
      model,
      provider,
      messages,
      parameters,
      organizationId: config.organizationId,
      userId: config.userId,
      tools: tools ?? [],
      streaming: { enabled: true },
      context: {
        source: config.source ?? 'agent',
        sessionId: config.sourceId,
      },
      structuredOutput: responseFormat
        ? { enabled: true, schema: responseFormat.jsonSchema as Record<string, unknown> }
        : undefined,
      forceSystem: config.forceSystem ?? false,
    }

    // Accumulated state across chunks
    let fullContent = ''
    let lastToolCalls: ToolCall[] = []
    let lastUsage: UsageMetrics = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    let lastProviderType: string | undefined
    let lastCredentialSource: string | undefined
    let lastReasoningContent: string | undefined
    let lastFinishReason: string | undefined
    let lastStopReason: string | undefined

    /**
     * Write the `AiUsage` row for this call and deduct SYSTEM credits. Runs
     * exactly once per call, from the stream loop's `finally` — so a turn that
     * errors or is aborted mid-stream still bills the tokens it burned, which
     * a caller-side per-turn drain could never do. Never throws: a billing
     * failure must not take down the turn that earned it.
     */
    let usageRecorded = false
    const recordUsage = async () => {
      if (usageRecorded) return
      usageRecorded = true
      if (lastUsage.total_tokens <= 0) return
      try {
        await usageService.trackUsage({
          organizationId: config.organizationId,
          userId: config.userId,
          provider,
          model,
          usage: lastUsage,
          timestamp: new Date(),
          source,
          sourceId: config.sourceId,
          providerType: lastProviderType as 'SYSTEM' | 'CUSTOM' | undefined,
          credentialSource: lastCredentialSource as
            | 'SYSTEM'
            | 'CUSTOM'
            | 'MODEL_SPECIFIC'
            | 'LOAD_BALANCED'
            | undefined,
          // `creditsUsed` omitted: metered from real USD COGS per call (0 for BYO).
        })
      } catch (error) {
        logger.error('Failed to track LLM usage', {
          model,
          provider,
          source,
          sourceId: config.sourceId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const stream = orchestrator.streamInvoke(request)

    // Buffer text deltas to reduce SSE event count.
    // Flush when buffer exceeds threshold or on a 50ms timer.
    const BATCH_CHAR_THRESHOLD = 50
    const BATCH_FLUSH_MS = 50
    let deltaBuffer = ''
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const pendingDeltas: string[] = []
    const flushBuffer = () => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      if (deltaBuffer) {
        pendingDeltas.push(deltaBuffer)
        deltaBuffer = ''
      }
    }
    const scheduleFlush = () => {
      if (!flushTimer) {
        flushTimer = setTimeout(flushBuffer, BATCH_FLUSH_MS)
      }
    }

    // Reasoning content buffer (same batching strategy as content deltas)
    let reasoningDeltaBuffer = ''
    let reasoningFlushTimer: ReturnType<typeof setTimeout> | null = null
    const pendingReasoningDeltas: string[] = []
    const flushReasoningBuffer = () => {
      if (reasoningFlushTimer) {
        clearTimeout(reasoningFlushTimer)
        reasoningFlushTimer = null
      }
      if (reasoningDeltaBuffer) {
        pendingReasoningDeltas.push(reasoningDeltaBuffer)
        reasoningDeltaBuffer = ''
      }
    }
    const scheduleReasoningFlush = () => {
      if (!reasoningFlushTimer) {
        reasoningFlushTimer = setTimeout(flushReasoningBuffer, BATCH_FLUSH_MS)
      }
    }

    try {
      while (true) {
        // Check abort signal before each iteration
        if (signal?.aborted) {
          flushBuffer()
          return
        }

        const { value: chunk, done } = await stream.next()

        if (done) {
          // Flush any remaining buffered text and reasoning
          flushBuffer()
          flushReasoningBuffer()

          // The return value of the generator is the final LLMInvocationResponse
          const response = chunk
          if (response) {
            fullContent = response.content || fullContent
            lastToolCalls = response.tool_calls ?? lastToolCalls
            lastUsage = response.usage ?? lastUsage
            lastProviderType = response.providerType ?? lastProviderType
            lastCredentialSource = response.credentialSource ?? lastCredentialSource
            lastReasoningContent = response.reasoning_content ?? lastReasoningContent
            const meta = (response as { metadata?: Record<string, unknown> }).metadata
            if (meta && typeof meta.stopReason === 'string') {
              lastStopReason = meta.stopReason
            }
          }
          break
        }

        // Buffer text deltas
        if (chunk.delta) {
          fullContent += chunk.delta
          deltaBuffer += chunk.delta
          if (deltaBuffer.length >= BATCH_CHAR_THRESHOLD) {
            flushBuffer()
          } else {
            scheduleFlush()
          }
        }

        // Buffer reasoning deltas
        if (chunk.reasoning_delta) {
          reasoningDeltaBuffer += chunk.reasoning_delta
          if (reasoningDeltaBuffer.length >= BATCH_CHAR_THRESHOLD) {
            flushReasoningBuffer()
          } else {
            scheduleReasoningFlush()
          }
        }

        // Yield any flushed reasoning batches
        while (pendingReasoningDeltas.length > 0) {
          yield { type: 'reasoning-delta' as const, delta: pendingReasoningDeltas.shift()! }
        }

        // Yield any flushed batches
        while (pendingDeltas.length > 0) {
          yield { type: 'text-delta' as const, delta: pendingDeltas.shift()! }
        }

        // Yield tool calls when they appear on the final chunk
        if (chunk.toolCalls && chunk.toolCalls.length > 0) {
          lastToolCalls = chunk.toolCalls
        }

        // Track usage from chunks
        if (chunk.usage) {
          lastUsage = chunk.usage
        }

        // Capture finishReason / stopReason from the terminal chunk so downstream
        // consumers can detect truncation (`length` / `max_tokens`).
        if (chunk.finishReason) {
          lastFinishReason = chunk.finishReason
        }
        const chunkMeta = chunk.metadata as
          | { stopReason?: unknown; providerType?: unknown; credentialSource?: unknown }
          | undefined
        if (chunkMeta && typeof chunkMeta.stopReason === 'string') {
          lastStopReason = chunkMeta.stopReason
        }
        // Credential metadata from the orchestrator's synthetic gate chunk —
        // the only way an aborted stream learns whether it spent SYSTEM credits.
        if (chunkMeta && typeof chunkMeta.providerType === 'string') {
          lastProviderType = chunkMeta.providerType
        }
        if (chunkMeta && typeof chunkMeta.credentialSource === 'string') {
          lastCredentialSource = chunkMeta.credentialSource
        }
      }
    } catch (error) {
      logger.error('LLM stream error', {
        model,
        error: error instanceof Error ? error.message : String(error),
      })
      if (flushTimer) clearTimeout(flushTimer)
      if (reasoningFlushTimer) clearTimeout(reasoningFlushTimer)
      throw error
    } finally {
      await recordUsage()
    }

    // Yield any remaining buffered deltas
    while (pendingReasoningDeltas.length > 0) {
      yield { type: 'reasoning-delta' as const, delta: pendingReasoningDeltas.shift()! }
    }
    while (pendingDeltas.length > 0) {
      yield { type: 'text-delta' as const, delta: pendingDeltas.shift()! }
    }

    const truncated = lastFinishReason === 'length' || lastStopReason === 'max_tokens'

    logger.info('LLM complete', {
      model,
      contentLength: fullContent.length,
      toolCallCount: lastToolCalls.length,
      hasContent: fullContent.length > 0,
      contentPreview: fullContent.slice(0, 500),
      usage: lastUsage,
      finishReason: lastFinishReason,
      stopReason: lastStopReason,
      truncated,
    })

    // Prompt-cache instrumentation (provider-neutral). Reads the unified cache
    // fields each provider client populates on UsageMetrics. Keys are chosen to
    // avoid the logger's `token`/`secret`/`apikey` redaction markers so the
    // counts actually survive into the log (the `usage` object above is
    // redacted because its keys contain "token"). See plans/kopilot/cache/.
    if (lastUsage.total_tokens > 0) {
      const cachedInput = lastUsage.cached_input_tokens ?? 0
      const cacheWrite = lastUsage.cache_write_tokens ?? 0
      const promptInput = lastUsage.prompt_tokens
      // Provider semantics differ: OpenAI's prompt_tokens INCLUDES cached reads;
      // Anthropic's EXCLUDES them. Normalize to a single total + rate-limit cost.
      const includesCached = (provider ?? '').toLowerCase().includes('openai')
      const totalInput = includesCached
        ? promptInput + cacheWrite
        : promptInput + cachedInput + cacheWrite
      // Input that actually counts toward the provider's input rate limit
      // (cached reads are free on Anthropic/OpenAI; cache writes are not).
      const rateLimitInput = includesCached
        ? promptInput - cachedInput + cacheWrite
        : promptInput + cacheWrite
      logger.info('LLM cache metrics', {
        provider,
        model,
        promptInput,
        cachedInput,
        cacheWrite,
        outputCount: lastUsage.completion_tokens,
        totalInput,
        rateLimitInput,
        cachedPct: totalInput > 0 ? Math.round((cachedInput / totalInput) * 100) : 0,
      })
    }

    if (truncated) {
      logger.warn('LLM response was truncated by max_tokens — tool_use input may be incomplete', {
        model,
        provider,
        outputTokens: lastUsage.completion_tokens,
        contentLength: fullContent.length,
        toolCallCount: lastToolCalls.length,
        truncatedToolNames: lastToolCalls
          .filter((tc) => {
            const args = tc.function.arguments
            if (typeof args !== 'string' || args.length === 0) return true
            try {
              JSON.parse(args)
              return false
            } catch {
              return true
            }
          })
          .map((tc) => tc.function.name),
      })
    }

    if (fullContent.length === 0 && lastToolCalls.length === 0) {
      logger.warn('LLM returned empty response with no tool calls', {
        model,
        provider,
        messageCount: messages.length,
        hasResponseFormat: !!responseFormat,
      })
    }

    // Yield individual tool calls
    for (const toolCall of lastToolCalls) {
      yield { type: 'tool-call' as const, toolCall }
    }

    // Yield usage
    if (lastUsage.total_tokens > 0) {
      yield { type: 'usage' as const, usage: lastUsage }
    }

    // Yield done event
    yield {
      type: 'done' as const,
      content: fullContent,
      toolCalls: lastToolCalls,
      usage: lastUsage,
      providerType: lastProviderType,
      credentialSource: lastCredentialSource,
      reasoning_content: lastReasoningContent,
      finishReason: lastFinishReason,
    }
  }
}
