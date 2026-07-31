// packages/lib/src/ai/providers/groq/__tests__/groq-llm-client.test.ts

import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CLIENT_CONFIG, type LLMInvokeParams } from '../../../clients/base/types'
import { GroqLLMClient } from '../groq-llm-client'

/** Shape the OpenAI-compatible SDK receives after the client processes params. */
interface SentPayload {
  messages: { role: string; content: string }[]
  response_format?: { type: string; json_schema?: { strict?: boolean } }
  json_schema?: unknown
}

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

  // `json_schema` travels as a JSON string — that is what the orchestrator sends
  // (`JSON.stringify(request.structuredOutput.schema)`).
  function jsonSchemaParams(model: string): LLMInvokeParams {
    return {
      model,
      messages: [{ role: 'user', content: 'Say hello' }],
      response_format: 'json_schema',
      json_schema: JSON.stringify({
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      }),
    }
  }

  /** Payload the client handed to the OpenAI-compatible SDK on its first call. */
  function firstCallPayload(createMock: ReturnType<typeof vi.fn>): SentPayload {
    const call = createMock.mock.calls[0]
    if (!call) throw new Error('expected the API client to have been called')
    return call[0]
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

    const sent = firstCallPayload(createMock)
    expect(sent.response_format).toEqual({ type: 'json_object' })
    expect(sent.json_schema).toBeUndefined()
    // Schema is injected into the system prompt on the downgrade path
    expect(sent.messages[0]?.role).toBe('system')
    expect(sent.messages[0]?.content).toContain('JSON Schema')
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

    const sent = firstCallPayload(createMock)
    expect(sent.response_format?.type).toBe('json_schema')
    expect(sent.response_format?.json_schema?.strict).toBe(true)
  })
})
