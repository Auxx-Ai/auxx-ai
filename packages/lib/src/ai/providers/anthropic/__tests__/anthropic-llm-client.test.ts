// packages/lib/src/ai/providers/anthropic/__tests__/anthropic-llm-client.test.ts

import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CLIENT_CONFIG } from '../../../clients/base/types'
import { AnthropicLLMClient, STRUCTURED_OUTPUT_TOOL_NAME } from '../anthropic-llm-client'

/** Outbound payload of the first recorded `messages.create()` call. */
function sentPayload(mock: { mock: { calls: unknown[][] } }): Record<string, any> {
  const call = mock.mock.calls[0]
  if (!call) throw new Error('expected messages.create() to have been called')
  return call[0] as Record<string, any>
}

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

    const [toolCall] = response.tool_calls ?? []
    if (!toolCall) throw new Error('expected at least one tool call')
    expect(toolCall.function.name).toBe('get_weather')

    const args = JSON.parse(toolCall.function.arguments as string)
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

  it('enforces json_schema output via forced tool use', async () => {
    const client = createClient()

    const response = await client.invoke({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'Classify the sentiment of: "I love this product!"' }],
      parameters: { max_tokens: 256 },
      response_format: 'json_schema',
      json_schema: JSON.stringify({
        type: 'object',
        properties: {
          sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
          confidence: { type: 'number' },
        },
        required: ['sentiment', 'confidence'],
      }),
    })

    // The forced tool_use input comes back as JSON-stringified content.
    const parsed = JSON.parse(response.content)
    expect(parsed.sentiment).toBe('positive')
    expect(typeof parsed.confidence).toBe('number')
    expect(response.tool_calls).toEqual([])
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

/**
 * Unit tests for sampling-parameter handling. No API key required — the
 * Anthropic SDK is mocked so we can inspect the exact request payload.
 *
 * Fable 5 / Opus 4.8 / Opus 4.7 reject temperature/top_p/top_k with a 400.
 * The client must strip them; unrestricted models must keep them.
 */
describe('AnthropicLLMClient sampling-parameter stripping', () => {
  function createClientWithSpy() {
    const create = vi.fn(async (params: any) => ({
      id: 'msg_test',
      model: params.model,
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 2 },
      stop_reason: 'end_turn',
    }))

    const mockAnthropic = { messages: { create } } as unknown as Anthropic
    const client = new AnthropicLLMClient(mockAnthropic, {
      ...DEFAULT_CLIENT_CONFIG,
      retries: { ...DEFAULT_CLIENT_CONFIG.retries, maxAttempts: 1 },
    })
    return { client, create }
  }

  it('strips temperature/top_p for sampling-restricted models (Opus 4.8)', async () => {
    const { client, create } = createClientWithSpy()

    await client.invoke({
      model: 'claude-opus-4-8',
      messages: [{ role: 'user', content: 'Hi' }],
      parameters: { max_tokens: 32, temperature: 0, top_p: 0.9 },
    })

    const sent = sentPayload(create)
    expect(sent.temperature).toBeUndefined()
    expect(sent.top_p).toBeUndefined()
  })

  it('strips sampling params for Fable 5 and Opus 4.7', async () => {
    for (const model of ['claude-fable-5', 'claude-opus-4-7']) {
      const { client, create } = createClientWithSpy()

      await client.invoke({
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        parameters: { max_tokens: 32, temperature: 0.7, top_p: 0.95 },
      })

      const sent = sentPayload(create)
      expect(sent.temperature, model).toBeUndefined()
      expect(sent.top_p, model).toBeUndefined()
    }
  })

  it('keeps temperature/top_p for unrestricted models (Sonnet 4.6)', async () => {
    const { client, create } = createClientWithSpy()

    await client.invoke({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Hi' }],
      parameters: { max_tokens: 32, temperature: 0.5, top_p: 0.9 },
    })

    const sent = sentPayload(create)
    expect(sent.temperature).toBe(0.5)
    expect(sent.top_p).toBe(0.9)
  })
})

/**
 * Unit tests for forced tool-use structured output. No API key required —
 * the Anthropic SDK is mocked so we can inspect the exact request payload
 * and shape the response.
 *
 * When a json_schema response format is requested WITHOUT user tools, the
 * client must register a synthetic tool whose input_schema is the requested
 * schema and force it via tool_choice — not just inject prompt instructions.
 */
describe('AnthropicLLMClient forced tool-use structured output', () => {
  const schema = {
    type: 'object',
    properties: {
      sentiment: { type: 'string', enum: ['positive', 'negative'], 'x-auxx': { fieldId: 'f1' } },
      score: { type: 'number' },
    },
    required: ['sentiment', 'score'],
  }

  function createClientWithSpy(response?: Record<string, unknown>) {
    const create = vi.fn(async (params: any) => ({
      id: 'msg_test',
      model: params.model,
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 2 },
      stop_reason: 'end_turn',
      ...response,
    }))

    const mockAnthropic = { messages: { create } } as unknown as Anthropic
    const client = new AnthropicLLMClient(mockAnthropic, {
      ...DEFAULT_CLIENT_CONFIG,
      retries: { ...DEFAULT_CLIENT_CONFIG.retries, maxAttempts: 1 },
    })
    return { client, create }
  }

  it('sends the synthetic tool with forced tool_choice for schema requests', async () => {
    const { client, create } = createClientWithSpy()

    await client.invoke({
      model: 'claude-sonnet-4-6',
      messages: [
        { role: 'system', content: 'Extract the sentiment.' },
        { role: 'user', content: 'I love this product!' },
      ],
      parameters: { max_tokens: 256 },
      response_format: 'json_schema',
      json_schema: JSON.stringify(schema),
    })

    const sent = sentPayload(create)
    expect(sent.tools).toHaveLength(1)
    expect(sent.tools[0].name).toBe(STRUCTURED_OUTPUT_TOOL_NAME)
    expect(sent.tools[0].input_schema.type).toBe('object')
    expect(sent.tools[0].input_schema.required).toEqual(['sentiment', 'score'])
    expect(sent.tool_choice).toEqual({
      type: 'tool',
      name: STRUCTURED_OUTPUT_TOOL_NAME,
      disable_parallel_tool_use: true,
    })

    // Editor-only x-auxx vendor keywords must be stripped from input_schema.
    expect(sent.tools[0].input_schema.properties.sentiment['x-auxx']).toBeUndefined()
    expect(sent.tools[0].input_schema.properties.sentiment.enum).toEqual(['positive', 'negative'])

    // No prompt-injected schema instructions on the forced tool-use path.
    const systemText = (sent.system ?? []).map((b: any) => b.text).join('\n')
    expect(systemText).toBe('Extract the sentiment.')
  })

  it('maps the forced tool_use input to JSON content instead of tool_calls', async () => {
    const structured = { sentiment: 'positive', score: 0.92 }
    const { client } = createClientWithSpy({
      content: [
        { type: 'tool_use', id: 'toolu_1', name: STRUCTURED_OUTPUT_TOOL_NAME, input: structured },
      ],
      stop_reason: 'tool_use',
    })

    const response = await client.invoke({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'I love this product!' }],
      parameters: { max_tokens: 256 },
      response_format: 'json_schema',
      json_schema: JSON.stringify(schema),
    })

    // The synthetic tool call is NOT surfaced as a tool call…
    expect(response.tool_calls).toEqual([])
    // …its input is the answer: JSON-stringified content keeps downstream
    // JSON.parse(response.content) consumers working.
    expect(JSON.parse(response.content)).toEqual(structured)
    expect(response.metadata?.structured_output).toEqual(structured)
  })

  it('falls back to prompt injection when the request has user tools', async () => {
    const { client, create } = createClientWithSpy()

    await client.invoke({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the weather',
            parameters: {
              type: 'object',
              properties: { location: { type: 'string' } },
              required: ['location'],
            },
          },
        },
      ],
      parameters: { max_tokens: 256 },
      response_format: 'json_schema',
      json_schema: JSON.stringify(schema),
    })

    const sent = sentPayload(create)
    // User tools kept as-is; no synthetic tool, no forced tool_choice.
    expect(sent.tools).toHaveLength(1)
    expect(sent.tools[0].name).toBe('get_weather')
    expect(sent.tool_choice).toBeUndefined()

    // Legacy prompt-injection behavior applies instead.
    const systemText = (sent.system ?? []).map((b: any) => b.text).join('\n')
    expect(systemText).toContain('IMPORTANT RESPONSE FORMAT REQUIREMENTS')
  })

  it('falls back to prompt injection for non-object schemas', async () => {
    const { client, create } = createClientWithSpy()

    await client.invoke({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Summarize this.' }],
      parameters: { max_tokens: 256 },
      response_format: 'json_schema',
      json_schema: JSON.stringify({ type: 'string' }),
    })

    const sent = sentPayload(create)
    expect(sent.tools).toBeUndefined()
    expect(sent.tool_choice).toBeUndefined()

    const systemText = (sent.system ?? []).map((b: any) => b.text).join('\n')
    expect(systemText).toContain('IMPORTANT RESPONSE FORMAT REQUIREMENTS')
  })

  it('keeps prompt injection for streaming requests (handleResponseFormat)', () => {
    const { client } = createClientWithSpy()

    const processed = client.handleResponseFormat({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Summarize this.' }],
      stream: true,
      response_format: 'json_schema',
      json_schema: JSON.stringify(schema),
    })

    expect((processed as any).structuredOutputToolSchema).toBeUndefined()
    const systemMessage = processed.messages.find((m) => m.role === 'system')
    expect(systemMessage?.content).toContain('IMPORTANT RESPONSE FORMAT REQUIREMENTS')
  })
})
