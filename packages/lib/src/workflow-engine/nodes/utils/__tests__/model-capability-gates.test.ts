// packages/lib/src/workflow-engine/nodes/utils/__tests__/model-capability-gates.test.ts

import { describe, expect, it } from 'vitest'
import type { ModelCapabilities } from '../../../../ai/providers/types'
import { resolveCapabilityGates } from '../model-capability-gates'

function makeCaps(supports: Partial<ModelCapabilities['supports']>): ModelCapabilities {
  return {
    provider: 'test',
    modelId: 'test-model',
    displayName: 'Test Model',
    icon: '',
    color: '',
    contextLength: 128000,
    maxTokens: 4096,
    modelType: 'llm',
    fetchFrom: 'predefined-model',
    features: ['chat'],
    supports: supports as ModelCapabilities['supports'],
  } as ModelCapabilities
}

describe('resolveCapabilityGates', () => {
  it('returns no gates when neither feature is enabled', () => {
    const gates = resolveCapabilityGates(
      'deepseek-chat',
      { structuredOutputEnabled: false, filesEnabled: false },
      makeCaps({ structured: false, vision: false, fileInput: false })
    )
    expect(gates.skipStructuredOutput).toBe(false)
    expect(gates.skipFiles).toBe(false)
    expect(gates.warnings).toEqual([])
  })

  it('skips structured output only when the flag is explicitly false', () => {
    const gates = resolveCapabilityGates(
      'test-model',
      { structuredOutputEnabled: true, filesEnabled: false },
      makeCaps({ structured: false })
    )
    expect(gates.skipStructuredOutput).toBe(true)
    expect(gates.warnings).toEqual(['Structured output skipped — not supported by Test Model'])
  })

  it('skips files only when BOTH vision and fileInput are explicitly false', () => {
    const bothFalse = resolveCapabilityGates(
      'test-model',
      { structuredOutputEnabled: false, filesEnabled: true },
      makeCaps({ vision: false, fileInput: false })
    )
    expect(bothFalse.skipFiles).toBe(true)
    expect(bothFalse.warnings).toEqual(['File attachments skipped — not supported by Test Model'])

    const visionOnly = resolveCapabilityGates(
      'test-model',
      { structuredOutputEnabled: false, filesEnabled: true },
      makeCaps({ vision: true, fileInput: false })
    )
    expect(visionOnly.skipFiles).toBe(false)
  })

  it('fails open for custom models with empty supports flags', () => {
    const gates = resolveCapabilityGates(
      'my-custom-llama',
      { structuredOutputEnabled: true, filesEnabled: true },
      makeCaps({})
    )
    expect(gates.skipStructuredOutput).toBe(false)
    expect(gates.skipFiles).toBe(false)
    expect(gates.warnings).toEqual([])
  })

  it('fails open for unknown models (null capabilities)', () => {
    const gates = resolveCapabilityGates(
      'unknown-model',
      { structuredOutputEnabled: true, filesEnabled: true },
      null
    )
    expect(gates.skipStructuredOutput).toBe(false)
    expect(gates.skipFiles).toBe(false)
  })

  it('resolves deepseek-chat from the provider registry (files gated, structured allowed)', () => {
    const gates = resolveCapabilityGates('deepseek-chat', {
      structuredOutputEnabled: true,
      filesEnabled: true,
    })
    expect(gates.skipStructuredOutput).toBe(false)
    expect(gates.skipFiles).toBe(true)
    expect(gates.warnings).toHaveLength(1)
    expect(gates.warnings[0]).toContain('File attachments skipped')
  })
})
