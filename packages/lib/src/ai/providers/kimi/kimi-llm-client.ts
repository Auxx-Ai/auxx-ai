// packages/lib/src/ai/providers/kimi/kimi-llm-client.ts

import { OpenAILLMClient } from '../openai/openai-llm-client'

/**
 * Kimi LLM client that extends OpenAI's client.
 *
 * Kimi's API is OpenAI-compatible. For kimi-k2.5, the OpenAI-compatible
 * client handles everything (chat, tools, structured output, vision).
 *
 * Future: Thinking mode models (kimi-k2-thinking, kimi-k2-thinking-turbo)
 * use a `thinking` parameter ({type: "enabled"} / {type: "disabled"}) rather
 * than DeepSeek's reasoning_content field. May need stripThinkingContent()
 * when those models are added.
 */
export class KimiLLMClient extends OpenAILLMClient {}
