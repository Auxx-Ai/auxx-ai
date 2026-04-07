// packages/lib/src/ai/providers/qwen/qwen-llm-client.ts

import { OpenAILLMClient } from '../openai/openai-llm-client'

/**
 * Qwen LLM client that extends OpenAI's client.
 *
 * Qwen's DashScope API is OpenAI-compatible. For the initial qwen-plus-latest
 * model (non-reasoning), no overrides are needed — the OpenAI-compatible client
 * handles everything.
 *
 * Future: When thinking models (qwen3.5-flash, qwen3-max) are added, override
 * prepareReasoningContent() — likely same as DeepSeek (keep only last assistant's).
 */
export class QwenLLMClient extends OpenAILLMClient {}
