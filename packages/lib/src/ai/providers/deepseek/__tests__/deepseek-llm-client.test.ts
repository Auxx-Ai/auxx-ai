// packages/lib/src/ai/providers/deepseek/__tests__/deepseek-llm-client.test.ts

import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CLIENT_CONFIG } from '../../../clients/base/types'
import { DeepSeekLLMClient } from '../deepseek-llm-client'

describe('DeepSeekLLMClient', () => {
  function createMockApiClient(createMock: ReturnType<typeof vi.fn>) {
    return {
      chat: {
        completions: {
          create: createMock,
        },
      },
    } as any
  }

  it('completes a basic request using OpenAI-compatible API', async () => {
    const createMock = vi.fn().mockResolvedValueOnce({
      id: 'chatcmpl-test',
      model: 'deepseek-chat',
      choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    })

    const client = new DeepSeekLLMClient(createMockApiClient(createMock), DEFAULT_CLIENT_CONFIG)
    const response = await client.invoke({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(response.content).toBe('Hello!')
    expect(response.usage.total_tokens).toBe(8)
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('strips reasoning_content from previous assistant messages', async () => {
    const createMock = vi.fn().mockResolvedValueOnce({
      id: 'chatcmpl-test',
      model: 'deepseek-reasoner',
      choices: [{ message: { content: 'Follow-up answer' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    })

    const client = new DeepSeekLLMClient(createMockApiClient(createMock), DEFAULT_CLIENT_CONFIG)
    await client.invoke({
      model: 'deepseek-reasoner',
      messages: [
        { role: 'user', content: 'What is 2+2?' },
        {
          role: 'assistant',
          content: '4',
          reasoning_content: 'Let me think... 2+2=4',
        } as any,
        { role: 'user', content: 'And 3+3?' },
      ],
    })

    expect(createMock).toHaveBeenCalledTimes(1)
    const sentMessages = createMock.mock.calls[0][0].messages
    const assistantMsg = sentMessages.find((m: any) => m.role === 'assistant')
    expect(assistantMsg.content).toBe('4')
    expect(assistantMsg.reasoning_content).toBeUndefined()
  })

  it('preserves messages without reasoning_content unchanged', async () => {
    const createMock = vi.fn().mockResolvedValueOnce({
      id: 'chatcmpl-test',
      model: 'deepseek-chat',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    })

    const client = new DeepSeekLLMClient(createMockApiClient(createMock), DEFAULT_CLIENT_CONFIG)
    await client.invoke({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'bye' },
      ],
    })

    const sentMessages = createMock.mock.calls[0][0].messages
    expect(sentMessages).toHaveLength(4)
    expect(sentMessages[0]).toEqual({ role: 'system', content: 'You are helpful.' })
    expect(sentMessages[2]).toEqual({ role: 'assistant', content: 'Hello!' })
  })
})
