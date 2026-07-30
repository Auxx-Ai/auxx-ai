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
   * DeepSeek's OpenAI-compatible endpoint only supports legacy JSON mode
   * (`response_format: { type: 'json_object' }`), not strict Structured Outputs
   * (`{ type: 'json_schema' }`) — sending the latter returns
   * `400 This response_format type is unavailable now`. Returning false routes
   * json_schema requests through the base client's downgrade path, which emits
   * json_object and injects the schema into the system prompt.
   */
  protected override modelSupportsStrictJsonSchema(): boolean {
    return false
  }

  /**
   * Keep `reasoning_content` ONLY on an assistant message that is still inside
   * the current tool-calling cycle; strip it everywhere else.
   *
   * DeepSeek rejects (400) reasoning carried over from a COMPLETED turn, but
   * requires it on the last assistant message while a tool-calling cycle is
   * still open. The two cases are told apart by what follows that message: a
   * later `user` message means the turn closed, so its reasoning must go.
   *
   *   [user, assistant(reasoning, tool_calls), tool]  → cycle open,   keep
   *   [user, assistant(reasoning), user]              → turn closed,  strip
   */
  protected override prepareReasoningContent(messages: Message[]): Message[] {
    const lastAssistantWithReasoningIdx = messages.findLastIndex(
      (m) => m.role === 'assistant' && m.reasoning_content
    )

    if (lastAssistantWithReasoningIdx === -1) return messages

    const turnClosed = messages
      .slice(lastAssistantWithReasoningIdx + 1)
      .some((m) => m.role === 'user')
    const keepIdx = turnClosed ? -1 : lastAssistantWithReasoningIdx

    return messages.map((msg, i) => {
      if (i !== keepIdx && msg.role === 'assistant' && msg.reasoning_content) {
        const { reasoning_content, ...rest } = msg
        return rest
      }
      return msg
    })
  }
}
