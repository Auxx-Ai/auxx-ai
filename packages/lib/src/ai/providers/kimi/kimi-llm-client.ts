// packages/lib/src/ai/providers/kimi/kimi-llm-client.ts

import { OpenAILLMClient } from '../openai/openai-llm-client'

/**
 * Kimi LLM client that extends OpenAI's client.
 *
 * Kimi's API is OpenAI-compatible. For kimi-k2.5, the OpenAI-compatible
 * client handles everything (chat, tools, structured output, vision).
 *
 * kimi-k2.5 has thinking/reasoning enabled by default. The API returns
 * `reasoning_content` in responses and requires it in subsequent assistant
 * messages. The agent framework preserves reasoning_content across turns
 * so Kimi gets what it expects — no special handling needed here.
 */
export class KimiLLMClient extends OpenAILLMClient {}
