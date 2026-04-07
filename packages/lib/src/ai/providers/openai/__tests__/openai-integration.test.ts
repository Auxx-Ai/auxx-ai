// packages/lib/src/ai/providers/openai/__tests__/openai-integration.test.ts
//
// Integration tests for OpenAI models against the real API.
// Skipped when OPENAI_API_KEY is not set (never runs in CI).
// Tests a representative subset of models to avoid rate limiting.

import {
  DEFAULT_CLIENT_CONFIG,
  type LLMStreamChunk,
  type LLMStreamResult,
} from '../../../clients/base/types'
import type { ModelCapabilities } from '../../types'
import { ModelType } from '../../types'
import { OPENAI_MODELS } from '../openai-defaults'
import { OpenAILLMClient } from '../openai-llm-client'

// ---------------------------------------------------------------------------
// Representative model subset — one per family to stay within rate limits
// ---------------------------------------------------------------------------

/** Models to test — covers each family/class without exhaustive enumeration */
const REPRESENTATIVE_MODELS = [
  'gpt-5.4-nano', // GPT-5.4 (cheapest, fast)
  'gpt-5.4-mini', // GPT-5.4 mid-tier
  'gpt-4.1-nano', // GPT-4.1 (non-reasoning baseline)
  'o4-mini', // O-series reasoning
  'gpt-5.2', // GPT-5.2 conditional reasoning
]

interface TestModelEntry {
  modelId: string
  supports: ModelCapabilities['supports']
  isReasoning: boolean
  maxTokensParam: 'max_completion_tokens' | 'max_tokens'
}

function buildTestMatrix(): TestModelEntry[] {
  return REPRESENTATIVE_MODELS.filter((id) => {
    const cap = OPENAI_MODELS[id]
    return cap && cap.modelType === ModelType.LLM && !cap.deprecated && !cap.retired
  }).map((id) => {
    const cap = OPENAI_MODELS[id]!
    const isReasoning = !!cap.parameterRestrictions?.isReasoningModel
    return {
      modelId: id,
      supports: cap.supports,
      isReasoning,
      maxTokensParam: isReasoning ? 'max_completion_tokens' : 'max_tokens',
    }
  })
}

const TEST_MODELS = buildTestMatrix()

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SIMPLE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'get_weather',
    description: 'Get weather for a city',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
}

const JSON_SCHEMA_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'greeting',
    strict: true,
    schema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
      additionalProperties: false,
    },
  },
}

function buildParams(entry: TestModelEntry, overrides: Record<string, any> = {}) {
  // Don't send reasoning_effort — the Chat Completions API only accepts 'medium'
  // (the default) for most models. The full range (low/high/xhigh) requires the
  // Responses API which we don't use yet.
  // Use 200 tokens — reasoning models need headroom for thinking tokens.
  const parameters: Record<string, any> = {}
  parameters[entry.maxTokensParam] = 200

  return {
    model: entry.modelId,
    messages: [{ role: 'user' as const, content: 'Say hi' }],
    parameters,
    ...overrides,
  }
}

/** Retry helper — OpenAI rate limits can return misleading 404s */
async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 2000): Promise<T> {
  let lastError: unknown
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (i < retries) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)))
      }
    }
  }
  throw lastError
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

describe.skipIf(!OPENAI_API_KEY)('OpenAI Integration Tests', () => {
  let client: OpenAILLMClient

  beforeAll(async () => {
    const realOpenAI = await vi.importActual<typeof import('openai')>('openai')
    const apiClient = new realOpenAI.default({ apiKey: OPENAI_API_KEY })
    client = new OpenAILLMClient(apiClient, {
      ...DEFAULT_CLIENT_CONFIG,
      retries: { ...DEFAULT_CLIENT_CONFIG.retries, maxAttempts: 1 },
      circuitBreaker: {
        failureThreshold: 999,
        resetTimeout: 1,
        monitoringPeriod: 1,
      },
      timeouts: { request: 120_000, connection: 60_000 },
    })
  })

  describe.each(TEST_MODELS.map((m) => [m.modelId, m] as const))('%s', (_id, entry) => {
    const timeout = 60_000

    it(
      'completes a basic request',
      async () => {
        const res = await withRetry(() => client.invoke(buildParams(entry)))
        expect(res.content.length).toBeGreaterThan(0)
        expect(res.usage.total_tokens).toBeGreaterThan(0)
      },
      timeout
    )

    if (entry.supports.streaming) {
      it(
        'streams a response',
        async () => {
          const res = await withRetry(async () => {
            const gen = client.streamInvoke(buildParams(entry))
            let r: IteratorResult<LLMStreamChunk, LLMStreamResult>
            do {
              r = await gen.next()
            } while (!r.done)
            return r.value
          })
          expect(res.content.length).toBeGreaterThan(0)
        },
        timeout
      )
    }

    if (entry.supports.toolCalling) {
      it(
        'handles tool calling',
        async () => {
          const res = await withRetry(() =>
            client.invoke(
              buildParams(entry, {
                messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
                tools: [SIMPLE_TOOL],
                parameters: { [entry.maxTokensParam]: 200 },
              })
            )
          )
          // Model may choose to call the tool or respond directly — both are valid
          expect(res.content !== undefined || res.tool_calls !== undefined).toBe(true)
        },
        timeout
      )
    }

    if (entry.supports.structured) {
      it(
        'returns structured output',
        async () => {
          const res = await withRetry(() =>
            client.invoke(
              buildParams(entry, {
                messages: [{ role: 'user', content: 'Say hello' }],
                response_format: JSON_SCHEMA_FORMAT,
                parameters: { [entry.maxTokensParam]: 200 },
              })
            )
          )
          expect(res.content).toBeTruthy()
          const parsed = JSON.parse(res.content)
          expect(parsed).toHaveProperty('message')
        },
        timeout
      )
    }
  })
})
