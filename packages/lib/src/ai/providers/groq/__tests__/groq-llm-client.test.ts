// packages/lib/src/ai/providers/groq/__tests__/groq-llm-client.test.ts

import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CLIENT_CONFIG } from '../../../clients/base/types'
import { GroqLLMClient } from '../groq-llm-client'

describe('GroqLLMClient', () => {
  function createMockApiClient(createMock: ReturnType<typeof vi.fn>) {
    return {
      chat: {
        completions: {
          create: createMock,
        },
      },
    } as any
  }

  function jsonSchemaParams(model: string) {
    return {
      model,
      messages: [{ role: 'user' as const, content: 'Say hello' }],
      response_format: 'json_schema' as const,
      json_schema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
    }
  }

  it('completes a basic request using the OpenAI-compatible API', async () => {
    const createMock = vi.fn().mockResolvedValueOnce({
      id: 'chatcmpl-test',
      model: 'llama-3.3-70b-versatile',
      choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    })

    const client = new GroqLLMClient(createMockApiClient(createMock), DEFAULT_CLIENT_CONFIG)
    const response = await client.invoke({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(response.content).toBe('Hello!')
    expect(response.usage.total_tokens).toBe(8)
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('downgrades json_schema to json_object for models without strict schema support', async () => {
    const createMock = vi.fn().mockResolvedValueOnce({
      id: 'chatcmpl-test',
      model: 'llama-3.1-8b-instant',
      choices: [{ message: { content: '{"message":"hi"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })

    const client = new GroqLLMClient(createMockApiClient(createMock), DEFAULT_CLIENT_CONFIG)
    // Unregistered model id so registry capability filtering doesn't interfere —
    // exercises the model-aware strict-schema gate directly.
    await client.invoke(jsonSchemaParams('llama-3.1-8b-instant'))

    const sent = createMock.mock.calls[0][0]
    expect(sent.response_format).toEqual({ type: 'json_object' })
    expect(sent.json_schema).toBeUndefined()
    // Schema is injected into the system prompt on the downgrade path
    expect(sent.messages[0].role).toBe('system')
    expect(sent.messages[0].content).toContain('JSON Schema')
  })

  it('keeps strict json_schema for openai/gpt-oss models', async () => {
    const createMock = vi.fn().mockResolvedValueOnce({
      id: 'chatcmpl-test',
      model: 'openai/gpt-oss-120b',
      choices: [{ message: { content: '{"message":"hi"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })

    const client = new GroqLLMClient(createMockApiClient(createMock), DEFAULT_CLIENT_CONFIG)
    await client.invoke(jsonSchemaParams('openai/gpt-oss-120b'))

    const sent = createMock.mock.calls[0][0]
    expect(sent.response_format.type).toBe('json_schema')
    expect(sent.response_format.json_schema.strict).toBe(true)
  })
})
