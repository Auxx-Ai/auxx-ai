// packages/lib/src/purchasing/intake/__tests__/transcribe-capability.test.ts
//
// §10: "a model that fails the file-input capability gate refuses out loud."
// The dialog asks this on OPEN, before a file is picked, so the refusal has to
// name the model and carry a reason — a silent empty draft is the failure mode
// this gate exists to prevent. No LLM is involved: only the model registry's own
// capability flags, which fail OPEN for unknown/BYO models.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  defaultModel: null as { provider: string; model: string } | null,
  capabilities: null as Record<string, unknown> | null,
}))

vi.mock('../../../cache/org-cache-helpers', () => ({
  getCachedDefaultModel: vi.fn(async () => h.defaultModel),
}))

vi.mock('../../../ai/providers/provider-registry', () => ({
  ProviderRegistry: { getModelCapabilities: () => h.capabilities },
}))

import { checkIntakeModelCapability } from '../transcribe'

beforeEach(() => {
  h.defaultModel = { provider: 'anthropic', model: 'claude-x' }
  h.capabilities = {
    displayName: 'Claude X',
    supports: { vision: true, fileInput: true, structured: true },
  }
})

describe('checkIntakeModelCapability', () => {
  it('passes a model that reads files and returns JSON', async () => {
    const result = await checkIntakeModelCapability('org_1')
    expect(result._unsafeUnwrap()).toEqual({ ok: true, modelId: 'claude-x', reason: null })
  })

  it('🛑 refuses out loud, naming the model, when it cannot read a file', async () => {
    h.capabilities = {
      displayName: 'Tiny Text 1',
      supports: { vision: false, fileInput: false, structured: true },
    }

    const { ok, modelId, reason } = (await checkIntakeModelCapability('org_1'))._unsafeUnwrap()
    expect(ok).toBe(false)
    expect(modelId).toBe('claude-x')
    expect(reason).toContain('Tiny Text 1')
  })

  it('refuses a model that cannot return structured output', async () => {
    h.capabilities = {
      displayName: 'Prose Only',
      supports: { vision: true, fileInput: true, structured: false },
    }

    const result = (await checkIntakeModelCapability('org_1'))._unsafeUnwrap()
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('Prose Only')
  })

  it('fails OPEN for a BYO model the registry has never heard of', async () => {
    h.capabilities = null
    const result = (await checkIntakeModelCapability('org_1'))._unsafeUnwrap()
    expect(result.ok).toBe(true)
  })

  it('falls back to a known model when the org has configured no default', async () => {
    h.defaultModel = null
    const result = (await checkIntakeModelCapability('org_1'))._unsafeUnwrap()
    expect(result.modelId).toBe('gpt-5.4-nano')
  })
})
