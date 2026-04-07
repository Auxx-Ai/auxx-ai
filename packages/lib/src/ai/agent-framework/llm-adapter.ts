// packages/lib/src/ai/agent-framework/llm-adapter.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { ToolCall, UsageMetrics } from '../clients/base/types'
import { LLMOrchestrator } from '../orchestrator/llm-orchestrator'
import type { LLMInvocationRequest, UsageTrackingService } from '../orchestrator/types'
import type { LLMCallParams, LLMStreamEvent } from './types'

const logger = createScopedLogger('agent-llm')

export interface LLMAdapterConfig {
  organizationId: string
  userId: string
  db?: Database
  usageService?: UsageTrackingService
  /** Source label for usage tracking (default: 'agent') */
  source?: string
  sourceId?: string
}

/**
 * Create a callModel function that wraps LLMOrchestrator streaming.
 * This is the only file in the agent framework that knows about provider details.
 */
export function createCallModel(config: LLMAdapterConfig) {
  const orchestrator = new LLMOrchestrator(config.usageService, config.db)

  return async function* callModel(params: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
    const { model, provider, messages, tools, parameters, responseFormat, signal } = params

    logger.info('Calling LLM', {
      model,
      provider,
      messageCount: messages.length,
      toolCount: tools?.length ?? 0,
      hasResponseFormat: !!responseFormat,
    })

    // Log messages for debugging (truncate long content)
    logger.debug('LLM messages', {
      model,
      messages: messages.map((m, i) => ({
        index: i,
        role: m.role,
        contentLength: m.content?.length ?? 0,
        contentPreview:
          typeof m.content === 'string' ? m.content.slice(0, 200) : '[non-string content]',
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
    }

    // Accumulated state across chunks
    let fullContent = ''
    let lastToolCalls: ToolCall[] = []
    let lastUsage: UsageMetrics = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    let lastProviderType: string | undefined
    let lastCredentialSource: string | undefined

    const stream = orchestrator.streamInvoke(request)

    try {
      while (true) {
        // Check abort signal before each iteration
        if (signal?.aborted) {
          return
        }

        const { value: chunk, done } = await stream.next()

        if (done) {
          // The return value of the generator is the final LLMInvocationResponse
          const response = chunk
          if (response) {
            fullContent = response.content || fullContent
            lastToolCalls = response.tool_calls ?? lastToolCalls
            lastUsage = response.usage ?? lastUsage
            lastProviderType = response.providerType ?? lastProviderType
            lastCredentialSource = response.credentialSource ?? lastCredentialSource
          }
          break
        }

        // Yield text deltas
        if (chunk.delta) {
          fullContent += chunk.delta
          yield { type: 'text-delta' as const, delta: chunk.delta }
        }

        // Yield tool calls when they appear on the final chunk
        if (chunk.toolCalls && chunk.toolCalls.length > 0) {
          lastToolCalls = chunk.toolCalls
        }

        // Track usage from chunks
        if (chunk.usage) {
          lastUsage = chunk.usage
        }
      }
    } catch (error) {
      logger.error('LLM stream error', {
        model,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }

    logger.info('LLM complete', {
      model,
      contentLength: fullContent.length,
      toolCallCount: lastToolCalls.length,
      hasContent: fullContent.length > 0,
      contentPreview: fullContent.slice(0, 500),
      usage: lastUsage,
    })

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
    }
  }
}
