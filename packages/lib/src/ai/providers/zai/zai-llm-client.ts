// packages/lib/src/ai/providers/zai/zai-llm-client.ts

import type { Message } from '../../clients/base/types'
import { OpenAILLMClient } from '../openai/openai-llm-client'

/**
 * Index of the last assistant message carrying `reasoning_content`, or -1.
 *
 * A manual reverse scan rather than `Array.prototype.findLastIndex` — the
 * package compiles against the shared `target: ES2022` lib, which does not
 * declare the ES2023 array methods.
 */
function findLastAssistantWithReasoningIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role === 'assistant' && message.reasoning_content) return i
  }
  return -1
}

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
  protected static override clientName = 'Zai-LLM'

  /**
   * Z.AI's API only documents legacy JSON mode
   * (`response_format: { type: 'json_object' }`), not strict Structured Outputs
   * (`{ type: 'json_schema' }`). Returning false routes json_schema requests
   * through the base client's downgrade path, which emits json_object and
   * injects the schema into the system prompt.
   */
  protected override modelSupportsStrictJsonSchema(): boolean {
    return false
  }

  protected override prepareReasoningContent(messages: Message[]): Message[] {
    const lastAssistantWithReasoningIdx = findLastAssistantWithReasoningIndex(messages)

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
