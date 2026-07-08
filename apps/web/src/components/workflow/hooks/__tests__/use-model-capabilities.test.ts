// apps/web/src/components/workflow/hooks/__tests__/use-model-capabilities.test.ts

import { describe, expect, it, vi } from 'vitest'

// The hook file imports the tRPC client + query-client for the (untested)
// react-query wiring — stub both so the pure resolver can be imported alone.
vi.mock('~/trpc/react', () => ({
  api: { aiIntegration: { getUnifiedModelData: { useQuery: vi.fn() } } },
}))
vi.mock('~/trpc/query-client', () => ({ ORG_STATIC_STALE_TIME: 60_000 }))

import { resolveModelCapabilities } from '../use-model-capabilities'

/** Minimal model entry matching the fields `resolveModelCapabilities` reads. */
function makeModel(overrides: Record<string, unknown> = {}) {
  return {
    modelId: 'gpt-test',
    displayName: 'GPT Test',
    features: ['chat'],
    isDefault: false,
    supports: {
      streaming: true,
      structured: true,
      vision: true,
      toolCalling: true,
      systemMessages: true,
      fileInput: true,
    },
    ...overrides,
  }
}

function makeData(
  providers: Array<{ provider: string; models: Array<Record<string, unknown>> }>,
  defaultModels: Record<string, { provider: string; model: string }> = {}
) {
  return { providers, defaultModels } as never
}

describe('resolveModelCapabilities', () => {
  const deepseekChat = makeModel({
    modelId: 'deepseek-chat',
    displayName: 'DeepSeek Chat',
    supports: {
      streaming: true,
      structured: true,
      vision: false,
      toolCalling: true,
      systemMessages: true,
      fileInput: false,
    },
  })

  const data = makeData(
    [
      { provider: 'openai', models: [makeModel({ isDefault: true })] },
      { provider: 'deepseek', models: [deepseekChat] },
      { provider: 'custom-provider', models: [makeModel({ modelId: 'my-llama', supports: {} })] },
    ],
    { llm: { provider: 'deepseek', model: 'deepseek-chat' } }
  )

  it('resolves an explicit provider + model reference', () => {
    const result = resolveModelCapabilities(data, { provider: 'deepseek', name: 'deepseek-chat' })
    expect(result.displayName).toBe('DeepSeek Chat')
    expect(result.supports?.vision).toBe(false)
    expect(result.supports?.fileInput).toBe(false)
    expect(result.supports?.structured).toBe(true)
  })

  it('resolves useDefault via defaultModels.llm', () => {
    const result = resolveModelCapabilities(data, { useDefault: true })
    expect(result.model?.modelId).toBe('deepseek-chat')
  })

  it('falls back to the isDefault flag when defaultModels has no llm entry', () => {
    const noDefaultsData = makeData(
      [{ provider: 'openai', models: [makeModel({ isDefault: true })] }],
      {}
    )
    const result = resolveModelCapabilities(noDefaultsData, { useDefault: true })
    expect(result.model?.modelId).toBe('gpt-test')
  })

  it('returns undefined supports for custom models with empty supports flags', () => {
    const result = resolveModelCapabilities(data, {
      provider: 'custom-provider',
      name: 'my-llama',
    })
    // supports is {} — no flag is explicitly false, so every feature reads as supported
    expect(result.model?.modelId).toBe('my-llama')
    expect(result.supports?.structured).toBeUndefined()
    expect(result.supports?.vision).toBeUndefined()
  })

  it('fails open for unknown models', () => {
    const result = resolveModelCapabilities(data, { provider: 'openai', name: 'does-not-exist' })
    expect(result.model).toBeUndefined()
    expect(result.supports).toBeUndefined()
    expect(result.displayName).toBeUndefined()
  })

  it('fails open when data is not loaded or model ref is missing', () => {
    expect(resolveModelCapabilities(undefined, { useDefault: true }).supports).toBeUndefined()
    expect(resolveModelCapabilities(data, undefined).supports).toBeUndefined()
    expect(resolveModelCapabilities(data, { provider: '', name: '' }).supports).toBeUndefined()
  })
})
