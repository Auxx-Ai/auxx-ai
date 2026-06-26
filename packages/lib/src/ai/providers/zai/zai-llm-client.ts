// packages/lib/src/ai/providers/zai/zai-llm-client.ts

import type { Message } from '../../clients/base/types'
import { OpenAILLMClient } from '../openai/openai-llm-client'

/**
 * Z.AI (GLM) LLM client that extends OpenAI's client.
 *
 * Z.AI's API is OpenAI-compatible. GLM models have thinking enabled by default and
 * return reasoning in a `reasoning_content` field (the DeepSeek pattern). Like DeepSeek,
 * prior-turn `reasoning_content` should not be sent back — we strip it from all assistant
 * messages except the last one in the current tool-calling cycle.
 *
 * Note: if real-API testing shows GLM tolerates or requires prior-turn reasoning_content
 * (the Kimi behavior), switch this override to simply `return messages`.
 */
export class ZaiLLMClient extends OpenAILLMClient {
  protected override prepareReasoningContent(messages: Message[]): Message[] {
    const lastAssistantWithReasoningIdx = messages.findLastIndex(
      (m) => m.role === 'assistant' && m.reasoning_content
    )

    if (lastAssistantWithReasoningIdx === -1) return messages

    return messages.map((msg, i) => {
      if (i < lastAssistantWithReasoningIdx && msg.role === 'assistant' && msg.reasoning_content) {
        const { reasoning_content, ...rest } = msg
        return rest
      }
      return msg
    })
  }
}
