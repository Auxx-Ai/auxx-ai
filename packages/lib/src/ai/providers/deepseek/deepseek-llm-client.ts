// packages/lib/src/ai/providers/deepseek/deepseek-llm-client.ts

import type { Message } from '../../clients/base/types'
import { OpenAILLMClient } from '../openai/openai-llm-client'

/**
 * DeepSeek LLM client that extends OpenAI's client.
 *
 * DeepSeek's API is OpenAI-compatible, but the `deepseek-reasoner` model
 * returns `reasoning_content` alongside `content` in responses. This client
 * preserves reasoning_content on the last assistant message and strips it
 * from all prior turns (DeepSeek requires this pattern).
 *
 * Multi-turn rules for reasoning_content:
 * - Do NOT pass reasoning_content from previous turns back in follow-up messages (causes 400 error)
 * - Within a single turn's tool-calling cycle, reasoning_content MUST be preserved on the last assistant
 */
export class DeepSeekLLMClient extends OpenAILLMClient {
  /**
   * Strip reasoning_content from all assistant messages except the last one.
   * DeepSeek requires that reasoning_content from prior turns is NOT sent back,
   * but the most recent assistant message's reasoning must be preserved within
   * the current tool-calling cycle.
   */
  protected override prepareReasoningContent(messages: Message[]): Message[] {
    // Find the last assistant message that has reasoning_content
    const lastAssistantWithReasoningIdx = messages.findLastIndex(
      (m) => m.role === 'assistant' && m.reasoning_content
    )

    if (lastAssistantWithReasoningIdx === -1) return messages

    // Strip reasoning_content from all assistant messages except the last one
    return messages.map((msg, i) => {
      if (i < lastAssistantWithReasoningIdx && msg.role === 'assistant' && msg.reasoning_content) {
        const { reasoning_content, ...rest } = msg
        return rest
      }
      return msg
    })
  }
}
