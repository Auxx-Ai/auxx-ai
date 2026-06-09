// packages/lib/src/ai/agent-framework/__tests__/effective-runtime.test.ts

import { describe, expect, it } from 'vitest'
import { parseProviderModel } from '../effective-runtime'

describe('parseProviderModel', () => {
  it('splits a well-formed provider:model id', () => {
    expect(parseProviderModel('anthropic:claude-opus-4-8')).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
    })
  })

  it('keeps colons inside the model segment', () => {
    expect(parseProviderModel('openai:gpt-5.4:preview')).toEqual({
      provider: 'openai',
      model: 'gpt-5.4:preview',
    })
  })

  it('returns null for unset values so callers fall to the next tier', () => {
    expect(parseProviderModel(null)).toBeNull()
    expect(parseProviderModel(undefined)).toBeNull()
    expect(parseProviderModel('')).toBeNull()
  })

  it('returns null for malformed ids (no colon, leading/trailing colon)', () => {
    expect(parseProviderModel('claude-opus-4-8')).toBeNull()
    expect(parseProviderModel(':model')).toBeNull()
    expect(parseProviderModel('provider:')).toBeNull()
  })
})
