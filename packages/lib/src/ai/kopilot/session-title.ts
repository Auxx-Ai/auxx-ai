// packages/lib/src/ai/kopilot/session-title.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { LLMOrchestrator } from '../orchestrator/llm-orchestrator'

const logger = createScopedLogger('kopilot-session-title')

/**
 * Generate a concise title (3-8 words) for a Kopilot session
 * based on the first user message.
 */
export async function generateSessionTitle(
  firstUserMessage: string,
  config: { organizationId: string; userId: string; db: Database }
): Promise<string> {
  const orchestrator = new LLMOrchestrator(undefined, config.db)

  const response = await orchestrator.invoke({
    model: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    organizationId: config.organizationId,
    userId: config.userId,
    messages: [
      {
        role: 'system',
        content: [
          'Your ONLY job is to output a short title (3-8 words) that summarizes the topic of the conversation below.',
          'Rules:',
          '- Output ONLY the title, nothing else.',
          '- Do NOT echo, quote, or paraphrase anything from the conversation.',
          '- Do NOT include filler phrases like "I\'d be happy to help" or "Here\'s a title".',
          "- Focus on the user's intent/topic, not the assistant's response.",
          '- Use title case.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `User message: ${firstUserMessage.slice(0, 300)}`,
      },
    ],
    tools: [],
    parameters: { max_tokens: 30 },
    context: { source: 'kopilot-title' },
  })

  let title = response.content?.trim() ?? ''

  // Strip quotes if the model wrapped the title
  title = title.replace(/^["']|["']$/g, '')

  if (!title) {
    logger.warn('Empty title generated', { organizationId: config.organizationId })
    return firstUserMessage.slice(0, 60)
  }

  return title.slice(0, 100)
}
