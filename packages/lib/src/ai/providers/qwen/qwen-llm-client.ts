// packages/lib/src/ai/providers/qwen/qwen-llm-client.ts

import { OpenAILLMClient } from '../openai/openai-llm-client'

/**
 * Qwen LLM client that extends OpenAI's client.
 *
 * Qwen's DashScope API is OpenAI-compatible. For the initial qwen-plus-latest
 * model (non-reasoning), no overrides are needed — the OpenAI-compatible client
 * handles everything.
 *
 * Future: Override for thinking mode models (e.g. qwen3-max) if added,
 * similar to DeepSeek's reasoning_content handling.
 */
export class QwenLLMClient extends OpenAILLMClient {}
