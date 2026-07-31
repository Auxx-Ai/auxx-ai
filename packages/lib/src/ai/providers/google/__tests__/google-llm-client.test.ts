// packages/lib/src/ai/providers/google/__tests__/google-llm-client.test.ts

import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CLIENT_CONFIG } from '../../../clients/base/types'
import { GoogleLLMClient } from '../google-llm-client'
import { firstCallArg } from '../test-helpers'

describe('GoogleLLMClient', () => {
  function createMockApiClient(createMock: ReturnType<typeof vi.fn>) {
    return {
      chat: {
        completions: {
          create: createMock,
        },
      },
    } as any
  }

  it('completes a basic request using the OpenAI-compatible API', async () => {
    const createMock = vi.fn().mockResolvedValueOnce({
      id: 'chatcmpl-test',
      model: 'gemini-2.5-flash',
      choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    })

    const client = new GoogleLLMClient(createMockApiClient(createMock), DEFAULT_CLIENT_CONFIG)
    const response = await client.invoke({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(response.content).toBe('Hello!')
    expect(response.usage.total_tokens).toBe(8)
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('sends strict json_schema structured output (Gemini compat layer supports it)', async () => {
    const createMock = vi.fn().mockResolvedValueOnce({
      id: 'chatcmpl-test',
      model: 'gemini-2.5-flash',
      choices: [{ message: { content: '{"message":"hi"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })

    const client = new GoogleLLMClient(createMockApiClient(createMock), DEFAULT_CLIENT_CONFIG)
    await client.invoke({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'Say hello' }],
      response_format: 'json_schema',
      // Production (llm-orchestrator) always serializes the schema before it
      // reaches the client, so the string form is what's under test.
      json_schema: JSON.stringify({
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      }),
    })

    const sent = firstCallArg(createMock, 'chat.completions.create')
    expect(sent.response_format.type).toBe('json_schema')
    expect(sent.response_format.json_schema.strict).toBe(true)
    expect(sent.response_format.json_schema.schema.properties.message).toEqual({ type: 'string' })
  })

  it('normalizes parameters the Gemini compat endpoint rejects', async () => {
    const createMock = vi.fn().mockResolvedValueOnce({
      id: 'chatcmpl-test',
      model: 'gemini-2.5-flash',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    })

    const client = new GoogleLLMClient(createMockApiClient(createMock), DEFAULT_CLIENT_CONFIG)
    // gemini-2.5-flash is registered, so applyDefaults injects camelCase rule
    // names (topP/topK/maxOutputTokens/thinkingBudget) — all must be translated
    // or dropped before the request or Gemini 400s on unknown fields.
    await client.invoke({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
      parameters: { temperature: 0.5 },
    })

    const sent = firstCallArg(createMock, 'chat.completions.create')
    expect(sent.temperature).toBe(0.5)
    expect(sent.top_p).toBeDefined()
    expect(sent.max_tokens).toBeDefined()
    expect(sent.topP).toBeUndefined()
    expect(sent.topK).toBeUndefined()
    expect(sent.top_k).toBeUndefined()
    expect(sent.maxOutputTokens).toBeUndefined()
    expect(sent.thinkingBudget).toBeUndefined()
    expect(sent.thinking_budget).toBeUndefined()
  })

  it('supports streaming via streamInvoke', async () => {
    async function* fakeStream() {
      yield {
        choices: [{ delta: { content: 'Hel' } }],
      }
      yield {
        choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }
    }
    const createMock = vi.fn().mockResolvedValueOnce(fakeStream())

    const client = new GoogleLLMClient(createMockApiClient(createMock), DEFAULT_CLIENT_CONFIG)
    const gen = client.streamInvoke({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
    })

    let result: IteratorResult<any, any>
    do {
      result = await gen.next()
    } while (!result.done)

    expect(result.value.content).toBe('Hello')
    expect(firstCallArg(createMock, 'chat.completions.create').stream).toBe(true)
  })
})
