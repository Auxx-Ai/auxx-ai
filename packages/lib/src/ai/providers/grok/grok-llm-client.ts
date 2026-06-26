// packages/lib/src/ai/providers/grok/grok-llm-client.ts

import { OpenAILLMClient } from '../openai/openai-llm-client'

/**
 * xAI (Grok) LLM client that extends OpenAI's client.
 *
 * Grok's API is OpenAI-compatible. The OpenAI-compatible client handles chat,
 * tools, structured output, vision, and the `reasoning_effort` parameter, so no
 * overrides are needed initially.
 *
 * Note: Grok reasoning models return `reasoning_content` in responses. If
 * multi-turn tool-calling cycles start returning 400s related to
 * `reasoning_content`, add a `prepareReasoningContent` override here — compare
 * the DeepSeek pattern (strip prior-turn reasoning) vs the Kimi pattern
 * (preserve all) to match what xAI accepts.
 */
export class GrokLLMClient extends OpenAILLMClient {}
