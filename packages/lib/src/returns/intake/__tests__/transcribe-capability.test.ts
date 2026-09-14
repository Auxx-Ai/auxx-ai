// packages/lib/src/returns/intake/__tests__/transcribe-capability.test.ts
//
// §3.1: "🛑 Gate on capability first — a model with no vision support must
// produce a clear refusal before the worker picks a file, not a silent empty
// draft."
//
// The dialog asks this on OPEN, before anyone has walked to the dock, so the
// refusal has to name the model and carry a reason a person can act on. No LLM
// is involved: only the model registry's own capability flags, which fail OPEN
// for unknown/BYO models.
//
// ⚠️ `transcribeLabel` itself gets no end-to-end test, for the reason
// `purchasing/intake` records: asserting it means mocking the orchestrator, S3
// and the file layer, which pins the mocks rather than the behaviour. The two
// halves worth testing — this gate and `parseTranscribedLabel` — are tested
// directly instead.

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

import type { Database } from '@auxx/database'
import { checkReturnIntakeModelCapability } from '../transcribe'

/** Never reached — the gate reads the registry and the org cache, not the database. */
const db = {} as Database

beforeEach(() => {
  h.defaultModel = { provider: 'anthropic', model: 'claude-x' }
  h.capabilities = {
    displayName: 'Claude X',
    supports: { vision: true, fileInput: true, structured: true },
  }
})

describe('checkReturnIntakeModelCapability', () => {
  it('passes a model that can see and can return JSON', async () => {
    const result = await checkReturnIntakeModelCapability(db, 'org_1')
    expect(result._unsafeUnwrap()).toEqual({ ok: true, modelId: 'claude-x', reason: null })
  })

  it('🛑 refuses out loud, naming the model, when it cannot read a file at all', async () => {
    h.capabilities = {
      displayName: 'Tiny Text 1',
      supports: { vision: false, fileInput: false, structured: true },
    }

    const { ok, modelId, reason } = (
      await checkReturnIntakeModelCapability(db, 'org_1')
    )._unsafeUnwrap()
    expect(ok).toBe(false)
    expect(modelId).toBe('claude-x')
    expect(reason).toContain('Tiny Text 1')
  })

  it('🔀 refuses a model that takes files but cannot SEE — every label is an image', async () => {
    // This is the case `resolveCapabilityGates` alone lets through: it raises
    // `skipFiles` only when vision AND fileInput are both false, which is right
    // for a PDF quote and wrong for a dock photo.
    h.capabilities = {
      displayName: 'Doc Reader 2',
      supports: { vision: false, fileInput: true, structured: true },
    }

    const { ok, reason } = (await checkReturnIntakeModelCapability(db, 'org_1'))._unsafeUnwrap()
    expect(ok).toBe(false)
    expect(reason).toContain('Doc Reader 2')
    expect(reason).toContain('cannot read images')
  })

  it('refuses a model that cannot return structured output', async () => {
    h.capabilities = {
      displayName: 'Prose Only',
      supports: { vision: true, fileInput: true, structured: false },
    }

    const { ok, reason } = (await checkReturnIntakeModelCapability(db, 'org_1'))._unsafeUnwrap()
    expect(ok).toBe(false)
    expect(reason).toContain('Prose Only')
  })

  it('fails OPEN for a BYO model the registry has never heard of', async () => {
    h.capabilities = null
    const result = (await checkReturnIntakeModelCapability(db, 'org_1'))._unsafeUnwrap()
    expect(result.ok).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('fails OPEN for a registered model whose supports block is empty', async () => {
    h.capabilities = { displayName: 'Mystery 9', supports: {} }
    expect((await checkReturnIntakeModelCapability(db, 'org_1'))._unsafeUnwrap().ok).toBe(true)
  })

  it('falls back to a known model when the org has configured no default', async () => {
    h.defaultModel = null
    const result = (await checkReturnIntakeModelCapability(db, 'org_1'))._unsafeUnwrap()
    expect(result.modelId).toBe('gpt-5.4-nano')
  })
})
