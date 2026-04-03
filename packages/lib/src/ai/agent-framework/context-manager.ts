// packages/lib/src/ai/agent-framework/context-manager.ts

import { createScopedLogger } from '@auxx/logger'
import type { Message } from '../clients/base/types'
import type { AgentEngineConfig, LLMCallParams, SessionMessage } from './types'

const logger = createScopedLogger('agent-context')

const DEFAULT_TOKEN_BUDGET = 100_000
const RECENT_MESSAGES_TO_KEEP = 10
const CHARS_PER_TOKEN_ESTIMATE = 4

export interface ContextManagerConfig {
  /** Max token budget for the conversation context (default: 100k) */
  tokenBudget?: number
  /** Number of recent messages to always keep intact (default: 10) */
  recentMessagesToKeep?: number
}

/**
 * Estimate token count for a message based on character length.
 * Uses a rough 4 chars/token heuristic — good enough for context management.
 */
function estimateTokens(content: string): number {
  return Math.ceil(content.length / CHARS_PER_TOKEN_ESTIMATE)
}

/**
 * Estimate total tokens for a list of session messages
 */
export function estimateMessageTokens(messages: SessionMessage[]): number {
  return messages.reduce((sum, msg) => {
    const contentTokens = typeof msg.content === 'string' ? estimateTokens(msg.content) : 0
    const toolCallTokens = msg.toolCalls ? estimateTokens(JSON.stringify(msg.toolCalls)) : 0
    return sum + contentTokens + toolCallTokens + 4 // 4 tokens overhead per message
  }, 0)
}

/**
 * Manage conversation context by summarizing old messages when over budget.
 *
 * Strategy:
 * 1. Keep the system message (index 0) always
 * 2. Keep the most recent N messages intact
 * 3. If total tokens exceed budget, summarize the middle section
 */
export async function manageContext(
  messages: SessionMessage[],
  config: AgentEngineConfig,
  contextConfig?: ContextManagerConfig
): Promise<SessionMessage[]> {
  const tokenBudget =
    contextConfig?.tokenBudget ?? config.contextTokenBudget ?? DEFAULT_TOKEN_BUDGET
  const recentCount = contextConfig?.recentMessagesToKeep ?? RECENT_MESSAGES_TO_KEEP

  const totalTokens = estimateMessageTokens(messages)

  // Under budget — no compression needed
  if (totalTokens <= tokenBudget) {
    logger.debug('Context within budget', {
      totalTokens,
      tokenBudget,
      messageCount: messages.length,
    })
    return messages
  }

  // Not enough messages to compress
  if (messages.length <= recentCount + 1) {
    return messages
  }

  // Split into: system (first), middle (to summarize), recent (to keep)
  const systemMessages = messages[0]?.role === 'system' ? [messages[0]] : []
  const startIdx = systemMessages.length
  const recentStartIdx = Math.max(startIdx, messages.length - recentCount)
  const middleMessages = messages.slice(startIdx, recentStartIdx)
  const recentMessages = messages.slice(recentStartIdx)

  // If there's nothing to summarize, return as-is
  if (middleMessages.length === 0) {
    return messages
  }

  // Build summary using the LLM
  logger.info('Summarizing context', {
    totalTokens,
    tokenBudget,
    middleMessageCount: middleMessages.length,
    recentMessageCount: recentMessages.length,
  })
  const summary = await summarizeMessages(middleMessages, config)

  const summaryMessage: SessionMessage = {
    role: 'system',
    content: `[Context Summary]\nThe following is a summary of the earlier conversation:\n${summary}`,
    timestamp: Date.now(),
    metadata: { type: 'context-summary', summarizedCount: middleMessages.length },
  }

  return [...systemMessages, summaryMessage, ...recentMessages]
}

/**
 * Summarize a set of messages using the LLM
 */
async function summarizeMessages(
  messages: SessionMessage[],
  config: AgentEngineConfig
): Promise<string> {
  const conversationText = messages.map((m) => `${m.role}: ${m.content}`).join('\n')

  const summaryPrompt: Message[] = [
    {
      role: 'system',
      content:
        'Summarize the following conversation concisely. Preserve key facts, decisions, tool results, and user intent. Omit filler and redundant information.',
    },
    {
      role: 'user',
      content: conversationText,
    },
  ]

  const params: LLMCallParams = {
    model: config.domainConfig.defaultModel,
    provider: config.domainConfig.defaultProvider,
    messages: summaryPrompt,
    parameters: { max_tokens: 1024, temperature: 0 },
  }

  let summary = ''
  for await (const event of config.callModel(params)) {
    if (event.type === 'done') {
      summary = event.content
    }
  }

  return summary || '[Summary unavailable]'
}
