// packages/lib/src/ai/providers/qwen/qwen-llm-client.ts

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
 * Qwen LLM client that extends OpenAI's client.
 *
 * Qwen's DashScope API is OpenAI-compatible. The Qwen 3.6/3.7 models support a
 * thinking mode, but on the compatible-mode endpoint commercial models run
 * non-thinking by default (we don't send `enable_thinking`), so they behave as
 * standard chat models.
 *
 * The `prepareReasoningContent()` override below is a safety net: if thinking is
 * ever enabled, the API returns `reasoning_content` alongside `content`, and
 * (like DeepSeek) prior turns' reasoning must NOT be sent back while the most
 * recent assistant message's reasoning must be preserved within the current
 * tool-calling cycle.
 */
export class QwenLLMClient extends OpenAILLMClient {
  /**
   * DashScope's compatible-mode endpoint only documents legacy JSON mode
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
