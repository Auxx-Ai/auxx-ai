// packages/lib/src/ai/providers/google/__tests__/google-integration.test.ts
//
// Data-driven integration tests for Google Gemini models via the
// OpenAI-compatible endpoint. Skipped when GOOGLE_API_KEY is not set.
// Adding a model to GOOGLE_MODELS auto-generates tests.

import { canRunLiveApi } from '../../../../test/live-api'
import {
  DEFAULT_CLIENT_CONFIG,
  type LLMStreamChunk,
  type LLMStreamResult,
} from '../../../clients/base/types'
import type { ModelCapabilities } from '../../types'
import { ModelType } from '../../types'
import { GOOGLE_MODELS } from '../google-defaults'
import { GoogleLLMClient } from '../google-llm-client'

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
  return Object.entries(GOOGLE_MODELS)
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
  // Gemini 2.5+ models think by default, so leave enough budget for the
  // thinking tokens plus the actual answer.
  parameters[entry.maxTokensParam] = 512

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

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY

describe.skipIf(!canRunLiveApi(GOOGLE_API_KEY))('Google Integration Tests', () => {
  let client: GoogleLLMClient

  beforeAll(async () => {
    const realOpenAI = await vi.importActual<typeof import('openai')>('openai')
    const apiClient = new realOpenAI.default({
      apiKey: GOOGLE_API_KEY,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    })
    client = new GoogleLLMClient(apiClient, {
      ...DEFAULT_CLIENT_CONFIG,
      retries: { ...DEFAULT_CLIENT_CONFIG.retries, maxAttempts: 1 },
      circuitBreaker: {
        failureThreshold: 999,
        resetTimeout: 1,
        monitoringPeriod: 1,
      },
      timeouts: { request: 120_000, connection: 60_000, completion: 300_000 },
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

    if (entry.supports.toolCalling) {
      it(
        'handles tool calling',
        async () => {
          const res = await client.invoke(
            buildParams(entry, {
              messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
              tools: [SIMPLE_TOOL],
            })
          )
          expect(res.content !== undefined || res.tool_calls !== undefined).toBe(true)
        },
        timeout
      )
    }

    if (entry.supports.structured) {
      it(
        'returns structured output (strict json_schema)',
        async () => {
          const res = await client.invoke(
            buildParams(entry, {
              messages: [{ role: 'user', content: 'Say hello' }],
              response_format: 'json_schema',
              json_schema: {
                type: 'object',
                properties: { message: { type: 'string' } },
                required: ['message'],
              },
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
