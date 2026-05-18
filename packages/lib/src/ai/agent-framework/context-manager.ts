// packages/lib/src/ai/agent-framework/context-manager.ts

import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils/generateId'
import type { Message } from '../clients/base/types'
import type {
  AgentEngineConfig,
  AssistantSessionMessage,
  ContentPart,
  LLMCallParams,
  SessionMessage,
} from './types'

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
 * Estimate token count for a string based on character length.
 * Uses a rough 4 chars/token heuristic — good enough for context management.
 */
function estimateTokens(content: string): number {
  return Math.ceil(content.length / CHARS_PER_TOKEN_ESTIMATE)
}

/**
 * Estimate total tokens for a list of session messages. Walks `parts[]` on
 * assistant messages (text/thinking text + tool_call args/output stringified)
 * and `content` strings on user/system messages.
 */
export function estimateMessageTokens(messages: SessionMessage[]): number {
  return messages.reduce((sum, msg) => {
    if (msg.role === 'assistant') {
      const parts = (msg as AssistantSessionMessage).parts
      const partsTokens = parts.reduce((s, p) => {
        if (p.type === 'text' || p.type === 'thinking') return s + estimateTokens(p.text)
        if (p.type === 'tool_call') {
          return (
            s +
            estimateTokens(JSON.stringify(p.args)) +
            (p.output !== undefined ? estimateTokens(JSON.stringify(p.output)) : 0)
          )
        }
        return s
      }, 0)
      return sum + partsTokens + 4
    }
    const contentTokens = typeof msg.content === 'string' ? estimateTokens(msg.content) : 0
    return sum + contentTokens + 4
  }, 0)
}

/**
 * Strip `thinking` parts from all assistant messages except the most recent
 * one with thinking. Reasoning is turn-specific — prior reasoning is stale
 * context that wastes tokens.
 */
export function stripStaleThinkingParts(messages: SessionMessage[]): SessionMessage[] {
  const lastIdx = messages.findLastIndex(
    (m) =>
      m.role === 'assistant' &&
      (m as AssistantSessionMessage).parts?.some((p) => p.type === 'thinking')
  )
  if (lastIdx === -1) return messages
  return messages.map((msg, i) => {
    if (i >= lastIdx || msg.role !== 'assistant') return msg
    const a = msg as AssistantSessionMessage
    if (!a.parts?.some((p) => p.type === 'thinking')) return msg
    return { ...a, parts: a.parts.filter((p) => p.type !== 'thinking') } as SessionMessage
  })
}

/**
 * Manage conversation context by summarizing old messages when over budget.
 *
 * Strategy:
 * 1. Strip stale thinking parts (only keep the last assistant's)
 * 2. Keep the system message (index 0) always
 * 3. Keep the most recent N messages intact
 * 4. If total tokens exceed budget, summarize the middle section
 *
 * Per answers §A.1: with the new parts shape, there are no tool messages —
 * tool results live on tool_call parts inside the parent assistant. The
 * tool-boundary walk-back is gone.
 */
export async function manageContext(
  messages: SessionMessage[],
  config: AgentEngineConfig,
  contextConfig?: ContextManagerConfig
): Promise<SessionMessage[]> {
  const tokenBudget =
    contextConfig?.tokenBudget ?? config.contextTokenBudget ?? DEFAULT_TOKEN_BUDGET
  const recentCount = contextConfig?.recentMessagesToKeep ?? RECENT_MESSAGES_TO_KEEP

  messages = stripStaleThinkingParts(messages)

  const totalTokens = estimateMessageTokens(messages)

  if (totalTokens <= tokenBudget) {
    logger.debug('Context within budget', {
      totalTokens,
      tokenBudget,
      messageCount: messages.length,
    })
    return messages
  }

  if (messages.length <= recentCount + 1) {
    return messages
  }

  const systemMessages = messages[0]?.role === 'system' ? [messages[0]] : []
  const startIdx = systemMessages.length
  const recentStartIdx = Math.max(startIdx, messages.length - recentCount)

  const middleMessages = messages.slice(startIdx, recentStartIdx)
  const recentMessages = messages.slice(recentStartIdx)

  if (middleMessages.length === 0) {
    return messages
  }

  logger.info('Summarizing context', {
    totalTokens,
    tokenBudget,
    middleMessageCount: middleMessages.length,
    recentMessageCount: recentMessages.length,
  })
  const summary = await summarizeMessages(middleMessages, config)

  const summaryMessage: SessionMessage = {
    id: generateId('msg'),
    role: 'system',
    content: `[Context Summary]\nThe following is a summary of the earlier conversation:\n${summary}`,
    timestamp: Date.now(),
    metadata: { type: 'context-summary', summarizedCount: middleMessages.length },
  }

  return [...systemMessages, summaryMessage, ...recentMessages]
}

/** Render a parts array as a string projection for summarization. */
function partsToProse(parts: ContentPart[]): string {
  const lines: string[] = []
  for (const p of parts) {
    if (p.type === 'text') {
      if (p.text.length > 0) lines.push(p.text)
    } else if (p.type === 'tool_call') {
      const argsPreview = previewSerialize(p.args, 200)
      const outputPreview =
        p.digest !== undefined
          ? previewSerialize(p.digest, 300)
          : p.output !== undefined
            ? previewSerialize(p.output, 300)
            : '(no result)'
      lines.push(`[tool: ${p.name}(${argsPreview}) → ${outputPreview}]`)
    }
    // thinking parts are dropped (turn-specific reasoning isn't summary-worthy)
  }
  return lines.join('\n')
}

function previewSerialize(value: unknown, max: number): string {
  let s: string
  try {
    s = JSON.stringify(value)
  } catch {
    s = String(value)
  }
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/**
 * Summarize a set of messages using the LLM.
 */
async function summarizeMessages(
  messages: SessionMessage[],
  config: AgentEngineConfig
): Promise<string> {
  const conversationText = messages
    .map((m) => {
      if (m.role === 'assistant') {
        return `assistant: ${partsToProse((m as AssistantSessionMessage).parts)}`
      }
      return `${m.role}: ${m.content}`
    })
    .join('\n')

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
