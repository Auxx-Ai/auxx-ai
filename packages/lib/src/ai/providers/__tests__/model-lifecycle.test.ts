// packages/lib/src/ai/providers/__tests__/model-lifecycle.test.ts

import { describe, expect, it } from 'vitest'
import { ProviderRegistry } from '../provider-registry'

describe('ProviderRegistry.assertModelNotRetired', () => {
  it('throws for retired model with replacement message', () => {
    // gemini-1.5-pro-latest is marked as retired with replacement gemini-2.5-pro
    expect(() => ProviderRegistry.assertModelNotRetired('gemini-1.5-pro-latest')).toThrow(
      'has been retired'
    )
    expect(() => ProviderRegistry.assertModelNotRetired('gemini-1.5-pro-latest')).toThrow(
      'gemini-2.5-pro'
    )
  })

  it('throws for retired model with MODEL_RETIRED code', () => {
    try {
      ProviderRegistry.assertModelNotRetired('gemini-1.5-flash-latest')
      expect.fail('Should have thrown')
    } catch (error: any) {
      expect(error.code).toBe('MODEL_RETIRED')
      expect(error.providerId).toBe('google')
    }
  })

  it('does not throw for active model', () => {
    expect(() => ProviderRegistry.assertModelNotRetired('gemini-2.5-flash')).not.toThrow()
  })

  it('does not throw for deprecated model', () => {
    // gemini-2.0-flash is deprecated but not retired
    expect(() => ProviderRegistry.assertModelNotRetired('gemini-2.0-flash')).not.toThrow()
  })

  it('does not throw for unknown model', () => {
    expect(() => ProviderRegistry.assertModelNotRetired('unknown-model-xyz')).not.toThrow()
  })
})

describe('model lifecycle flags', () => {
  it('retired models have replacement field set', () => {
    const retiredModels = Object.entries(ProviderRegistry.getAllModels()).filter(
      ([, caps]) => caps.retired
    )

    expect(retiredModels.length).toBeGreaterThan(0)

    for (const [modelId, caps] of retiredModels) {
      expect(caps.replacement).toBeTruthy()
    }
  })

  it('deprecated models are not also retired', () => {
    const models = ProviderRegistry.getAllModels()

    for (const [modelId, caps] of Object.entries(models)) {
      if (caps.deprecated) {
        expect(caps.retired).toBeFalsy()
      }
    }
  })

  it('active models are neither deprecated nor retired', () => {
    const activeModels = Object.entries(ProviderRegistry.getAllModels()).filter(
      ([, caps]) => !caps.deprecated && !caps.retired
    )

    expect(activeModels.length).toBeGreaterThan(0)
  })
})
