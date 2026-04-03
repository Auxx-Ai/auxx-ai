// packages/lib/src/ai/kopilot/session-title.ts

import { createScopedLogger } from '@auxx/logger'
import { LLMOrchestrator } from '../orchestrator/llm-orchestrator'

const logger = createScopedLogger('kopilot-session-title')

/**
 * Generate a concise title (5-8 words) for a Kopilot session
 * based on the first user message and assistant response.
 */
export async function generateSessionTitle(
  firstUserMessage: string,
  firstAssistantResponse: string,
  config: { organizationId: string; userId: string }
): Promise<string> {
  const orchestrator = new LLMOrchestrator()

  const response = await orchestrator.invoke({
    model: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    organizationId: config.organizationId,
    userId: config.userId,
    messages: [
      {
        role: 'system',
        content:
          'Generate a 5-8 word title for this conversation. No quotes, no prefix. Just the title.',
      },
      {
        role: 'user',
        content: `User: ${firstUserMessage.slice(0, 300)}\n\nAssistant: ${firstAssistantResponse.slice(0, 200)}`,
      },
    ],
    tools: [],
    context: { source: 'kopilot-title' },
  })

  const title = response.content?.trim() ?? ''

  if (!title) {
    logger.warn('Empty title generated', { organizationId: config.organizationId })
    return firstUserMessage.slice(0, 60)
  }

  return title.slice(0, 100)
}
