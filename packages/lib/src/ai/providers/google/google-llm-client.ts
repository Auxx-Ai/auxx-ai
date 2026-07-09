// packages/lib/src/ai/providers/google/google-llm-client.ts

import { OpenAILLMClient } from '../openai/openai-llm-client'

/**
 * Sampling-parameter keys the Gemini OpenAI-compat endpoint accepts, with the
 * rule-name (camelCase) → API-name translations applied first. Keys mapped to
 * null have no compat-endpoint equivalent and must be dropped — Gemini returns
 * `400 Unknown name "<field>": Cannot find field` for anything it doesn't know
 * (verified against the live endpoint; the "silently ignored" note in Google's
 * docs does not apply to chat completions).
 */
const PARAM_TRANSLATIONS: Record<string, string | null> = {
  topP: 'top_p',
  maxOutputTokens: 'max_tokens',
  // Gemini-native knobs with no OpenAI-compat equivalent:
  topK: null,
  top_k: null,
  thinkingBudget: null,
  thinking_budget: null,
}

const SUPPORTED_PARAMS = new Set([
  'temperature',
  'top_p',
  'max_tokens',
  'max_completion_tokens',
  'stop',
  'n',
  'presence_penalty',
  'frequency_penalty',
  'seed',
  'reasoning_effort',
])

/**
 * Google (Gemini) LLM client that extends OpenAI's client.
 *
 * Gemini exposes an OpenAI-compatible endpoint at
 * `https://generativelanguage.googleapis.com/v1beta/openai/` that handles chat,
 * streaming, tool calling, vision, and strict Structured Outputs
 * (`response_format: { type: 'json_schema' }`), so the base client's
 * `modelSupportsStrictJsonSchema` default (true) is kept.
 * See https://ai.google.dev/gemini-api/docs/openai.
 *
 * Notes:
 * - Gemini 2.5+ models think by default; tiny `max_tokens` values can return
 *   an empty `content` with `finish_reason: 'length'` rather than an error.
 * - Thinking-budget control needs `extra_body.google.thinking_config`, which
 *   isn't wired up yet — `thinkingBudget` params are dropped for now.
 */
export class GoogleLLMClient extends OpenAILLMClient {
  /**
   * Translate camelCase rule names (topP/maxOutputTokens) to their OpenAI
   * field names and drop everything the compat endpoint would 400 on
   * (topK, thinkingBudget, unknown keys).
   */
  protected override normalizeProviderParameters(
    parameters: Record<string, any>,
    _baseModel: string
  ): Record<string, any> {
    const normalized: Record<string, any> = {}

    for (const [key, value] of Object.entries(parameters)) {
      const translated = key in PARAM_TRANSLATIONS ? PARAM_TRANSLATIONS[key] : key
      if (translated === null) continue
      if (!SUPPORTED_PARAMS.has(translated)) continue
      normalized[translated] = value
    }

    return normalized
  }
}
