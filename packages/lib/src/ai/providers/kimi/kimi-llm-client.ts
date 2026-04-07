// packages/lib/src/ai/providers/kimi/kimi-llm-client.ts

import type { Message } from '../../clients/base/types'
import { OpenAILLMClient } from '../openai/openai-llm-client'

/**
 * Kimi LLM client that extends OpenAI's client.
 *
 * Kimi's API is OpenAI-compatible. For kimi-k2.5, the OpenAI-compatible
 * client handles everything (chat, tools, structured output, vision).
 *
 * kimi-k2.5 has thinking/reasoning enabled by default. The API returns
 * `reasoning_content` in responses and requires it in subsequent assistant
 * messages — Kimi requires reasoning_content on ALL assistant messages
 * in multi-turn conversations.
 */
export class KimiLLMClient extends OpenAILLMClient {
  /** Kimi requires reasoning_content on all assistant messages — preserve everything. */
  protected override prepareReasoningContent(messages: Message[]): Message[] {
    return messages
  }
}
