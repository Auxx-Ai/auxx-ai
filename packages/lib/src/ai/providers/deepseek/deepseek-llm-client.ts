// packages/lib/src/ai/providers/deepseek/deepseek-llm-client.ts

import type {
  LLMInvokeParams,
  LLMResponse,
  LLMStreamChunk,
  LLMStreamResult,
} from '../../clients/base/types'
import { OpenAILLMClient } from '../openai/openai-llm-client'

/**
 * DeepSeek LLM client that extends OpenAI's client.
 *
 * DeepSeek's API is OpenAI-compatible, but the `deepseek-reasoner` model
 * returns `reasoning_content` alongside `content` in responses. This client
 * captures that field and stores it in response metadata.
 *
 * Multi-turn rules for reasoning_content:
 * - Do NOT pass reasoning_content from previous turns back in follow-up messages (causes 400 error)
 * - Within a single turn's tool-calling cycle, reasoning_content MUST be preserved between rounds
 */
export class DeepSeekLLMClient extends OpenAILLMClient {
  async invoke(params: LLMInvokeParams): Promise<LLMResponse> {
    // Strip reasoning_content from any previous assistant messages to avoid 400 errors
    const cleanedParams = this.stripReasoningContentFromHistory(params)
    const response = await super.invoke(cleanedParams)
    return response
  }

  async *streamInvoke(params: LLMInvokeParams): AsyncGenerator<LLMStreamChunk, LLMStreamResult> {
    const cleanedParams = this.stripReasoningContentFromHistory(params)
    return yield* super.streamInvoke(cleanedParams)
  }

  /**
   * Remove reasoning_content from previous assistant messages to prevent 400 errors.
   * DeepSeek requires that reasoning_content from prior turns is NOT sent back.
   */
  private stripReasoningContentFromHistory(params: LLMInvokeParams): LLMInvokeParams {
    if (!params.messages) return params

    const cleanedMessages = params.messages.map((msg) => {
      if (msg.role === 'assistant' && (msg as any).reasoning_content) {
        const { reasoning_content, ...rest } = msg as any
        return rest
      }
      return msg
    })

    return { ...params, messages: cleanedMessages }
  }
}
