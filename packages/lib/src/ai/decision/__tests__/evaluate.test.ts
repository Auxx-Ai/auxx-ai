// packages/lib/src/ai/decision/__tests__/evaluate.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getCachedDefaultModel: vi.fn(),
  getCredentials: vi.fn(),
  getModelCapabilities: vi.fn(),
  createClient: vi.fn(),
  getDecisionClient: vi.fn(),
  nativeEvaluate: vi.fn(),
  enforceAiQuota: vi.fn(),
  trackUsage: vi.fn(),
  invoke: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: h.warn, error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('../../../cache', () => ({ getCachedDefaultModel: h.getCachedDefaultModel }))
vi.mock('../../providers/config', () => ({ getCredentials: h.getCredentials }))
vi.mock('../../providers/provider-registry', () => ({
  ProviderRegistry: {
    getModelCapabilities: h.getModelCapabilities,
    createClient: h.createClient,
  },
}))
vi.mock('../../quota/enforce-ai-quota', () => ({ enforceAiQuota: h.enforceAiQuota }))
vi.mock('../../usage/usage-tracking-service', () => ({
  UsageTrackingService: class {
    trackUsage = h.trackUsage
  },
}))
vi.mock('../../orchestrator/llm-orchestrator', () => ({
  LLMOrchestrator: class {
    invoke = h.invoke
  },
}))

import { NotFoundError } from '../../../errors'
import { QuotaExceededError } from '../../errors/quota-errors'
import { OrchestratorError } from '../../orchestrator/types'
import { ProviderError } from '../../providers/base/types'
import type { DecisionQuestion } from '../client'
import { evaluate } from '../evaluate'

const db = {} as never
const questions: Record<string, DecisionQuestion> = {
  spam: { type: 'noul', instructions: 'Is this spam?' },
}
const input = {
  organizationId: 'org_1',
  userId: null,
  state: 'hello',
  questions,
  source: 'mail_classification' as const,
  sourceId: 'msg_1',
}

const NATIVE = { provider: 'typesafe', model: 'jev-1.13.0' }
const NANO = { provider: 'openai', model: 'gpt-nano' }
const LLM = { provider: 'anthropic', model: 'claude-x' }

const nativeResult = {
  answers: { spam: { type: 'noul', probability: 0.8 } },
  confidenceKind: 'calibrated',
  provider: NATIVE.provider,
  model: NATIVE.model,
  usage: { inputTokens: 40, outputTokens: 0 },
}

function defaults(map: { decision?: object | null; llm?: object | null }) {
  h.getCachedDefaultModel.mockImplementation(
    async (_org: string, type: string) => (map as Record<string, object | null>)[type] ?? null
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  h.getModelCapabilities.mockImplementation((model: string) =>
    model === NATIVE.model ? { modelType: 'decision' } : { modelType: 'llm' }
  )
  h.getCredentials.mockResolvedValue({
    credentials: { apiKey: 'k' },
    providerType: 'SYSTEM',
    credentialSource: 'SYSTEM',
  })
  h.getDecisionClient.mockReturnValue({ evaluate: h.nativeEvaluate })
  h.createClient.mockResolvedValue({ getDecisionClient: h.getDecisionClient })
  h.nativeEvaluate.mockResolvedValue(nativeResult)
  h.invoke.mockImplementation(async (request: { provider: string; model: string }) => ({
    structured_output: { spam: 0.3 },
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    provider: request.provider,
  }))
})

describe('evaluate — resolution', () => {
  it('prefers the explicit model', async () => {
    defaults({ decision: NATIVE, llm: LLM })
    const result = await evaluate(db, { ...input, model: NANO })
    expect(result._unsafeUnwrap().model).toBe(NANO.model)
    expect(h.invoke.mock.calls[0]![0]).toMatchObject(NANO)
  })

  it('then the decision default', async () => {
    defaults({ decision: NANO, llm: LLM })
    await evaluate(db, input)
    expect(h.invoke.mock.calls[0]![0]).toMatchObject(NANO)
  })

  it('then the LLM default', async () => {
    defaults({ llm: LLM })
    await evaluate(db, input)
    expect(h.invoke.mock.calls[0]![0]).toMatchObject(LLM)
  })

  it('returns NotFoundError when nothing is configured', async () => {
    defaults({})
    const result = await evaluate(db, input)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })
})

describe('evaluate — native branch', () => {
  it('gates, calls getDecisionClient and tracks decision usage with a null user', async () => {
    defaults({ decision: NATIVE, llm: LLM })
    const result = await evaluate(db, input)

    expect(result._unsafeUnwrap()).toEqual(nativeResult)
    expect(h.getCredentials).toHaveBeenCalledWith(
      { db, organizationId: 'org_1', userId: '' },
      NATIVE.provider,
      NATIVE.model,
      'decision'
    )
    expect(h.enforceAiQuota).toHaveBeenCalledWith(db, {
      provider: NATIVE.provider,
      organizationId: 'org_1',
      userId: '',
      providerType: 'SYSTEM',
    })
    expect(h.createClient).toHaveBeenCalledWith(NATIVE.provider, 'org_1', '')
    expect(h.getDecisionClient).toHaveBeenCalledWith({ apiKey: 'k' })
    expect(h.nativeEvaluate).toHaveBeenCalledWith({ ...NATIVE, state: 'hello', questions })
    expect(h.trackUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        userId: null,
        provider: NATIVE.provider,
        model: NATIVE.model,
        modelType: 'decision',
        usage: { prompt_tokens: 40, completion_tokens: 0, total_tokens: 40 },
        providerType: 'SYSTEM',
        credentialSource: 'SYSTEM',
        source: 'mail_classification',
        sourceId: 'msg_1',
      })
    )
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('picks a member from a load-balancing pool', async () => {
    defaults({ decision: NATIVE, llm: LLM })
    h.getCredentials.mockResolvedValue({
      credentials: { apiKey: 'primary' },
      providerType: 'CUSTOM',
      credentialSource: 'LOAD_BALANCED',
      load_balancing: {
        enabled: true,
        configs: [
          { credentials: { apiKey: 'a' }, enabled: true, in_cooldown: false },
          { credentials: { apiKey: 'b' }, enabled: true, in_cooldown: false },
          { credentials: { apiKey: 'c' }, enabled: false, in_cooldown: false },
        ],
      },
    })
    await evaluate(db, input)
    expect(['a', 'b']).toContain(h.getDecisionClient.mock.calls[0]![0].apiKey)
  })
})

describe('evaluate — adapter branch', () => {
  it('leaves quota and metering to the orchestrator', async () => {
    defaults({ decision: NANO, llm: LLM })
    const result = await evaluate(db, input)

    expect(result._unsafeUnwrap()).toMatchObject({
      confidenceKind: 'self-reported',
      answers: { spam: { type: 'noul', probability: 0.3 } },
    })
    expect(h.enforceAiQuota).not.toHaveBeenCalled()
    expect(h.trackUsage).not.toHaveBeenCalled()
    expect(h.createClient).not.toHaveBeenCalled()
    expect(h.invoke.mock.calls[0]![0]).toMatchObject({ userId: null })
  })
})

describe('evaluate — fallback (D9)', () => {
  it('runs the adapter on the LLM default after LIMITED_USE_BLOCKED, logging once', async () => {
    defaults({ decision: NATIVE, llm: LLM })
    h.createClient.mockRejectedValue(
      new ProviderError('blocked', 'typesafe', 'LIMITED_USE_BLOCKED')
    )

    const result = await evaluate(db, input)

    expect(result._unsafeUnwrap()).toMatchObject({ ...LLM, confidenceKind: 'self-reported' })
    expect(h.invoke).toHaveBeenCalledTimes(1)
    expect(h.invoke.mock.calls[0]![0]).toMatchObject(LLM)
    expect(h.warn).toHaveBeenCalledTimes(1)
    expect(h.warn.mock.calls[0]![1]).toMatchObject({
      from: 'typesafe/jev-1.13.0',
      to: 'anthropic/claude-x',
    })
  })

  it('falls back when the native model has no credentials', async () => {
    defaults({ decision: NATIVE, llm: LLM })
    h.getCredentials.mockResolvedValue({ credentials: {} })
    const result = await evaluate(db, input)
    expect(result.isOk()).toBe(true)
    expect(h.enforceAiQuota).not.toHaveBeenCalled()
    expect(h.invoke.mock.calls[0]![0]).toMatchObject(LLM)
  })

  it('falls back from an adapter decision default whose provider is blocked', async () => {
    defaults({ decision: NANO, llm: LLM })
    h.invoke.mockRejectedValueOnce(
      new OrchestratorError(
        'failed',
        'invoke',
        NANO.provider,
        NANO.model,
        new ProviderError('blocked', NANO.provider, 'LIMITED_USE_BLOCKED')
      )
    )
    const result = await evaluate(db, input)
    expect(result.isOk()).toBe(true)
    expect(h.invoke.mock.calls[1]![0]).toMatchObject(LLM)
  })

  it('does not fall back on QuotaExceededError', async () => {
    defaults({ decision: NATIVE, llm: LLM })
    const quota = new QuotaExceededError('out of credits')
    h.enforceAiQuota.mockRejectedValue(quota)

    const result = await evaluate(db, input)

    expect(result._unsafeUnwrapErr()).toBe(quota)
    expect(h.invoke).not.toHaveBeenCalled()
    expect(h.warn).not.toHaveBeenCalled()
  })

  it('does not fall back when the resolved model already is the LLM default', async () => {
    defaults({ llm: LLM })
    const blocked = new ProviderError('blocked', LLM.provider, 'LIMITED_USE_BLOCKED')
    h.invoke.mockRejectedValue(blocked)

    const result = await evaluate(db, input)

    expect(result._unsafeUnwrapErr()).toBe(blocked)
    expect(h.invoke).toHaveBeenCalledTimes(1)
    expect(h.warn).not.toHaveBeenCalled()
  })

  it('returns the error when there is no LLM default to fall back to', async () => {
    defaults({ decision: NATIVE })
    const blocked = new ProviderError('blocked', 'typesafe', 'LIMITED_USE_BLOCKED')
    h.createClient.mockRejectedValue(blocked)
    expect((await evaluate(db, input))._unsafeUnwrapErr()).toBe(blocked)
  })

  it('returns err, never throws, when the fallback attempt fails too', async () => {
    defaults({ decision: NATIVE, llm: LLM })
    h.createClient.mockRejectedValue(
      new ProviderError('blocked', 'typesafe', 'LIMITED_USE_BLOCKED')
    )
    h.invoke.mockRejectedValue(new Error('second failure'))
    const result = await evaluate(db, input)
    expect(result._unsafeUnwrapErr().message).toBe('second failure')
  })
})
