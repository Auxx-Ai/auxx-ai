// packages/lib/src/ai/providers/anthropic/__tests__/anthropic-llm-client.test.ts

import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CLIENT_CONFIG } from '../../../clients/base/types'
import { AnthropicLLMClient } from '../anthropic-llm-client'

/**
 * Integration tests for the Anthropic LLM client.
 * These hit the real Anthropic API — requires ANTHROPIC_API_KEY in .env.
 */

const apiKey = process.env.ANTHROPIC_API_KEY

describe.skipIf(!apiKey)('AnthropicLLMClient integration', () => {
  function createClient() {
    const anthropic = new Anthropic({ apiKey: apiKey! })
    return new AnthropicLLMClient(anthropic, {
      ...DEFAULT_CLIENT_CONFIG,
      retries: { ...DEFAULT_CLIENT_CONFIG.retries, maxAttempts: 1 },
    })
  }

  it('invoke returns a text response', async () => {
    const client = createClient()

    const response = await client.invoke({
      model: 'claude-haiku-4-5-20251001',
      messages: [
        { role: 'system', content: 'Respond with exactly one word.' },
        { role: 'user', content: 'Say hello.' },
      ],
      parameters: { max_tokens: 32 },
    })

    expect(response.content).toBeTruthy()
    expect(response.model).toBe('claude-haiku-4-5-20251001')
    expect(response.usage.prompt_tokens).toBeGreaterThan(0)
    expect(response.usage.completion_tokens).toBeGreaterThan(0)
    expect(response.usage.total_tokens).toBeGreaterThan(0)
  }, 15_000)

  it('invoke with tool calling returns tool calls', async () => {
    const client = createClient()

    const response = await client.invoke({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'What is the weather in San Francisco?' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the current weather for a location',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string', description: 'City name' },
              },
              required: ['location'],
            },
          },
        },
      ],
      parameters: { max_tokens: 256 },
    })

    expect(response.tool_calls).toBeDefined()
    expect(response.tool_calls!.length).toBeGreaterThan(0)
    expect(response.tool_calls![0].function.name).toBe('get_weather')

    const args = JSON.parse(response.tool_calls![0].function.arguments as string)
    expect(args.location).toBeTruthy()
  }, 15_000)

  it('streaming invoke yields chunks and returns final result', async () => {
    const client = createClient()

    const stream = client.streamInvoke({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
      parameters: { max_tokens: 128 },
    })

    const chunks: string[] = []
    let result: any

    while (true) {
      const { value, done } = await stream.next()
      if (done) {
        result = value
        break
      }
      chunks.push(value.delta)
    }

    expect(chunks.length).toBeGreaterThan(0)
    expect(result).toBeDefined()
    expect(result.content).toBeTruthy()
    expect(result.content).toContain('1')
  }, 15_000)

  it('generates a session title (same prompt as kopilot-title)', async () => {
    const client = createClient()

    const firstUserMessage = 'I need help with my Shopify order #1234, it has not arrived yet'
    const firstAssistantResponse =
      'I can help you track your order. Let me look up the details for order #1234.'

    const response = await client.invoke({
      model: 'claude-haiku-4-5-20251001',
      messages: [
        {
          role: 'system',
          content:
            'Generate a 5-8 word title for this conversation. No quotes, no prefix. Just the title.',
        },
        {
          role: 'user',
          content: `User: ${firstUserMessage.slice(0, 300)}\n\nAssistant: ${firstAssistantResponse.slice(0, 200)}`,
        },
      ],
      parameters: { max_tokens: 64 },
    })

    expect(response.content).toBeTruthy()
    expect(response.content.length).toBeGreaterThan(5)
  }, 15_000)
})
