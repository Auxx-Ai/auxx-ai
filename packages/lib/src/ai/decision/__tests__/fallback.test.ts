// packages/lib/src/ai/decision/__tests__/fallback.test.ts

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError, UsageLimitError } from '../../../errors'
import { QuotaExceededError } from '../../errors/quota-errors'
import { OrchestratorError } from '../../orchestrator/types'
import { ProviderConfigurationError, ProviderError } from '../../providers/base/types'
import { isDecisionFallbackTrigger } from '../fallback'

const wrap = (cause: Error) =>
  new OrchestratorError('LLM invocation failed', 'invoke', 'p', 'm', cause)
const withProps = (message: string, props: Record<string, unknown>) =>
  Object.assign(new Error(message), props)

describe('isDecisionFallbackTrigger', () => {
  it.each([
    'LIMITED_USE_BLOCKED',
    'PROVIDER_NOT_REGISTERED',
    'DECISION_NOT_SUPPORTED',
    'PROVIDER_UNAVAILABLE',
    'REQUEST_TIMEOUT',
  ])('triggers on ProviderError %s, bare or wrapped', (code) => {
    expect(isDecisionFallbackTrigger(new ProviderError('x', 'p', code))).toBe(true)
    expect(isDecisionFallbackTrigger(wrap(new ProviderError('x', 'p', code)))).toBe(true)
  })

  it.each([
    'PROVIDER_NOT_FOUND',
    'SYSTEM_CREDENTIALS_MISSING',
    'CREDENTIALS_MISSING',
  ])('triggers on missing credentials: ProviderConfigurationError %s', (operation) => {
    expect(isDecisionFallbackTrigger(new ProviderConfigurationError('x', 'p', operation))).toBe(
      true
    )
  })

  it.each([429, 500, 503, 529])('triggers on status %i', (status) => {
    expect(isDecisionFallbackTrigger(wrap(withProps('boom', { status })))).toBe(true)
  })

  it.each([
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
  ])('triggers on code %s', (code) => {
    expect(isDecisionFallbackTrigger(withProps('socket', { code }))).toBe(true)
  })

  it('triggers on a cause chain ending in "fetch failed"', () => {
    expect(
      isDecisionFallbackTrigger(new Error('outer', { cause: new TypeError('fetch failed') }))
    ).toBe(true)
  })

  it('does not trigger on quota or rate-limit exhaustion (D9: billing)', () => {
    expect(isDecisionFallbackTrigger(wrap(new QuotaExceededError('out')))).toBe(false)
    const limit = new UsageLimitError({ metric: 'aiCompletions', current: 1, limit: 1 })
    expect(isDecisionFallbackTrigger(wrap(limit))).toBe(false)
  })

  it('does not trigger on a malformed answer', () => {
    expect(isDecisionFallbackTrigger(new UnprocessableEntityError('bad enum'))).toBe(false)
  })

  it('does not trigger on anything else', () => {
    expect(isDecisionFallbackTrigger(new Error('nope'))).toBe(false)
    expect(isDecisionFallbackTrigger(new ProviderError('x', 'p', 'PROVIDER_ERROR'))).toBe(false)
    expect(isDecisionFallbackTrigger(new ProviderConfigurationError('x', 'p', 'UNKNOWN'))).toBe(
      false
    )
    expect(isDecisionFallbackTrigger(withProps('bad request', { status: 400 }))).toBe(false)
    expect(isDecisionFallbackTrigger('string')).toBe(false)
    expect(isDecisionFallbackTrigger(undefined)).toBe(false)
  })
})
