// packages/lib/src/ai/providers/openai/__tests__/openai-llm-client.test.ts

import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CLIENT_CONFIG } from '../../../clients/base/types'
import { OpenAILLMClient } from '../openai-llm-client'

/** Outbound payload of the nth recorded `create()` call, or a loud failure. */
function payloadAt(mock: { mock: { calls: unknown[][] } }, index: number): Record<string, any> {
  const call = mock.mock.calls[index]
  if (!call) throw new Error(`expected a create() call at index ${index}`)
  return call[0] as Record<string, any>
}

describe('OpenAILLMClient request shaping', () => {
  it('retries once without reasoning-only params when reasoning_effort is rejected', async () => {
    const createMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unrecognized request argument supplied: reasoning_effort'))
      .mockResolvedValueOnce({
        id: 'chatcmpl-test',
        model: 'gpt-5.2',
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      })

    const apiClient = {
      chat: {
        completions: {
          create: createMock,
        },
      },
    } as any

    const client = new OpenAILLMClient(apiClient, DEFAULT_CLIENT_CONFIG)
    const response = await client.invoke({
      model: 'gpt-5.2',
      messages: [{ role: 'user', content: 'hi' }],
      parameters: {
        reasoning_effort: 'medium',
        verbosity: 'medium',
        max_tokens: 64,
      },
    })

    expect(response.content).toBe('ok')
    expect(createMock).toHaveBeenCalledTimes(2)
    expect(payloadAt(createMock, 0).reasoning_effort).toBe('medium')
    expect(payloadAt(createMock, 1).reasoning_effort).toBeUndefined()
    expect(payloadAt(createMock, 1).verbosity).toBeUndefined()
  })

  it('drops stale unsupported params for non-reasoning models before dispatch', async () => {
    const createMock = vi.fn().mockResolvedValueOnce({
      id: 'chatcmpl-test',
      model: 'gpt-4o',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    })

    const apiClient = {
      chat: {
        completions: {
          create: createMock,
        },
      },
    } as any

    const client = new OpenAILLMClient(apiClient, DEFAULT_CLIENT_CONFIG)
    const response = await client.invoke({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      parameters: {
        reasoning_effort: 'high',
        temperature: 0.25,
        max_tokens: 80,
        __unknown__: 'remove-me',
      },
    })

    expect(response.content).toBe('ok')
    expect(createMock).toHaveBeenCalledTimes(1)

    const outboundPayload = payloadAt(createMock, 0)
    expect(outboundPayload.reasoning_effort).toBeUndefined()
    expect(outboundPayload.__unknown__).toBeUndefined()
    expect(outboundPayload.temperature).toBe(0.25)
    expect(outboundPayload.max_tokens).toBe(80)
  })
})
