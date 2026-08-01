// packages/lib/src/ai/providers/groq/groq-llm-client.ts

import { OpenAILLMClient } from '../openai/openai-llm-client'

/**
 * Models Groq documents as supporting strict Structured Outputs
 * (`response_format: { type: 'json_schema' }` with `strict: true`).
 * See https://console.groq.com/docs/structured-outputs.
 */
const STRICT_JSON_SCHEMA_MODELS = new Set(['openai/gpt-oss-20b', 'openai/gpt-oss-120b'])

/**
 * Groq LLM client that extends OpenAI's client.
 *
 * Groq's API is OpenAI-compatible at `https://api.groq.com/openai/v1`
 * (see https://console.groq.com/docs/openai), so chat, streaming, and tool
 * calling all work through the base client.
 */
export class GroqLLMClient extends OpenAILLMClient {
  protected static override clientName = 'Groq-LLM'

  /**
   * Groq only supports strict Structured Outputs on the `openai/gpt-oss-*`
   * models — every other model (e.g. llama-3.3-70b-versatile) only offers
   * legacy JSON mode (`response_format: { type: 'json_object' }`). Returning
   * false routes json_schema requests through the base client's downgrade
   * path, which emits json_object and injects the schema into the system
   * prompt.
   */
  protected override modelSupportsStrictJsonSchema(model: string): boolean {
    return STRICT_JSON_SCHEMA_MODELS.has(this.getBaseModel(model))
  }
}
