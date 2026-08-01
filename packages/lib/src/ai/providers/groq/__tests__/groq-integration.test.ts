// packages/lib/src/ai/providers/groq/__tests__/groq-integration.test.ts
//
// Data-driven integration tests for Groq models.
// Skipped when GROQ_API_KEY is not set.
// Adding a model to GROQ_MODELS auto-generates tests.

import { canRunLiveApi } from '../../../../test/live-api'
import {
  DEFAULT_CLIENT_CONFIG,
  type LLMStreamChunk,
  type LLMStreamResult,
} from '../../../clients/base/types'
import type { ModelCapabilities } from '../../types'
import { ModelType } from '../../types'
import { GROQ_MODELS } from '../groq-defaults'
import { GroqLLMClient } from '../groq-llm-client'

// ---------------------------------------------------------------------------
// Test matrix — auto-built from registry
// ---------------------------------------------------------------------------

interface TestModelEntry {
  modelId: string
  supports: ModelCapabilities['supports']
  isReasoning: boolean
  maxTokensParam: 'max_tokens'
}

function buildTestMatrix(): TestModelEntry[] {
  return Object.entries(GROQ_MODELS)
    .filter(([_, cap]) => {
      if (cap.modelType !== ModelType.LLM) return false
      if (cap.deprecated || cap.retired) return false
      return true
    })
    .map(([id, cap]) => {
      const isReasoning = !!cap.parameterRestrictions?.isReasoningModel
      return {
        modelId: id,
        supports: cap.supports,
        isReasoning,
        maxTokensParam: 'max_tokens' as const,
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

function buildParams(entry: TestModelEntry, overrides: Record<string, any> = {}) {
  const parameters: Record<string, any> = {}
  parameters[entry.maxTokensParam] = 10

  return {
    model: entry.modelId,
    messages: [{ role: 'user' as const, content: 'Say hi' }],
    parameters,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const GROQ_API_KEY = process.env.GROQ_API_KEY

describe.skipIf(!canRunLiveApi(GROQ_API_KEY))('Groq Integration Tests', () => {
  let client: GroqLLMClient

  beforeAll(async () => {
    const realOpenAI = await vi.importActual<typeof import('openai')>('openai')
    const apiClient = new realOpenAI.default({
      apiKey: GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    })
    client = new GroqLLMClient(apiClient, {
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
    const timeout = 120_000

    it(
      'completes a basic request',
      async () => {
        const res = await client.invoke(buildParams(entry))
        expect(res.content.length).toBeGreaterThan(0)
        expect(res.usage.total_tokens).toBeGreaterThan(0)
      },
      timeout
    )

    if (entry.supports.streaming) {
      it(
        'streams a response',
        async () => {
          const gen = client.streamInvoke(buildParams(entry))
          let r: IteratorResult<LLMStreamChunk, LLMStreamResult>
          do {
            r = await gen.next()
          } while (!r.done)
          expect(r.value.content.length).toBeGreaterThan(0)
        },
        timeout
      )
    }

    if (entry.supports.toolCalling && !entry.isReasoning) {
      it(
        'handles tool calling',
        async () => {
          const res = await client.invoke(
            buildParams(entry, {
              messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
              tools: [SIMPLE_TOOL],
              parameters: { [entry.maxTokensParam]: 50 },
            })
          )
          expect(res.content !== undefined || res.tool_calls !== undefined).toBe(true)
        },
        timeout
      )
    }

    if (entry.supports.structured && !entry.isReasoning) {
      it(
        'returns structured output (JSON mode)',
        async () => {
          const res = await client.invoke(
            buildParams(entry, {
              messages: [
                {
                  role: 'system',
                  content: 'Respond with JSON only. Schema: { "message": string }',
                },
                { role: 'user', content: 'Say hello' },
              ],
              response_format: { type: 'json_object' },
              parameters: { [entry.maxTokensParam]: 50 },
            })
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
