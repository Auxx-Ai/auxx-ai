// packages/lib/src/ai/providers/__tests__/vendor-keyword-stripping.test.ts

import { describe, expect, it } from 'vitest'
import { DEFAULT_CLIENT_CONFIG } from '../../clients/base/types'
import { AnthropicLLMClient } from '../anthropic/anthropic-llm-client'
import { OpenAILLMClient } from '../openai/openai-llm-client'

/**
 * Schema editor leaf nodes carry `x-auxx` FieldType metadata and may use string
 * `format`s OpenAI strict mode rejects (e.g. `uri`). These must be cleaned at
 * the provider boundary so they never reach the LLM. See
 * plans/mcp/v5/structured-output-unification.md phase 5.
 */

const SCHEMA = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['open', 'closed'],
      'x-auxx': { fieldType: 'SINGLE_SELECT', options: [{ value: 'open', label: 'Open' }] },
    },
    site: { type: 'string', format: 'uri', 'x-auxx': { fieldType: 'URL' } },
    when: { type: 'string', format: 'date-time' },
  },
}

describe('OpenAI handleResponseFormat — schema cleaning', () => {
  const client = new OpenAILLMClient({} as any, DEFAULT_CLIENT_CONFIG)

  it('strips x-auxx and unsupported formats from the strict-mode schema', () => {
    const out = client.handleResponseFormat({
      model: 'gpt-5.2',
      messages: [{ role: 'user', content: 'hi' }],
      response_format: 'json_schema',
      json_schema: SCHEMA as any,
    } as any)

    const wrapped = (out.response_format as any).json_schema.schema
    const serialized = JSON.stringify(wrapped)
    expect(serialized).not.toContain('x-auxx')
    // `uri` is not an OpenAI strict format → dropped; `date-time` survives.
    expect(wrapped.properties.site.format).toBeUndefined()
    expect(wrapped.properties.when.format).toBe('date-time')
    // The enum value itself is preserved.
    expect(wrapped.properties.status.enum).toEqual(['open', 'closed'])
  })
})

describe('Anthropic createSchemaBasedInstruction — schema cleaning', () => {
  const client = new AnthropicLLMClient({} as any, DEFAULT_CLIENT_CONFIG)

  it('never injects x-auxx into the system prompt', () => {
    const out = client.handleResponseFormat({
      model: 'claude-opus-4-8',
      messages: [{ role: 'user', content: 'hi' }],
      response_format: 'json_schema',
      json_schema: SCHEMA as any,
    } as any)

    const systemText = out.messages
      .filter((m) => m.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n')
    expect(systemText).not.toContain('x-auxx')
    // The schema is still described (its properties reach the prompt).
    expect(systemText).toContain('status')
  })
})
