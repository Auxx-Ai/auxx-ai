// packages/lib/src/ai/quota/__tests__/enforce-ai-quota.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getQuotaStatus = vi.fn()
const consume = vi.fn()
const createUsageGuard = vi.fn()

vi.mock('../quota-service', () => ({
  QuotaService: class {
    getQuotaStatus = getQuotaStatus
  },
}))

vi.mock('../../../usage/create-usage-guard', () => ({
  createUsageGuard: (...args: unknown[]) => createUsageGuard(...args),
}))

const { enforceAiQuota } = await import('../enforce-ai-quota')
const { QuotaExceededError } = await import('../../errors/quota-errors')
const { UsageLimitError } = await import('../../../errors')

const db = {} as Database
const base = { provider: 'openai', organizationId: 'org_1', userId: 'user_1' }

beforeEach(() => {
  vi.clearAllMocks()
  getQuotaStatus.mockResolvedValue({ isExceeded: false })
  consume.mockResolvedValue({ allowed: true })
  createUsageGuard.mockResolvedValue({ consume })
})

describe('enforceAiQuota', () => {
  it('throws QuotaExceededError when SYSTEM credits are exhausted', async () => {
    getQuotaStatus.mockResolvedValue({
      isExceeded: true,
      quotaUsed: 100,
      quotaLimit: 100,
      bonusCredits: 0,
      quotaPeriodEnd: null,
    })

    await expect(enforceAiQuota(db, { ...base, providerType: 'SYSTEM' })).rejects.toBeInstanceOf(
      QuotaExceededError
    )
    expect(consume).not.toHaveBeenCalled()
  })

  it('checks credits when forceSystem is set on a CUSTOM org', async () => {
    getQuotaStatus.mockResolvedValue({ isExceeded: true })

    await expect(
      enforceAiQuota(db, { ...base, providerType: 'CUSTOM', forceSystem: true })
    ).rejects.toBeInstanceOf(QuotaExceededError)
  })

  it('throws UsageLimitError when the usage guard denies the call', async () => {
    consume.mockResolvedValue({ allowed: false, current: 5, limit: 5 })

    await expect(enforceAiQuota(db, { ...base, providerType: 'SYSTEM' })).rejects.toBeInstanceOf(
      UsageLimitError
    )
    expect(consume).toHaveBeenCalledWith('org_1', 'aiCompletions', { userId: 'user_1' })
  })

  it('skips the credit check for CUSTOM credentials but still consumes the rate limit', async () => {
    await expect(enforceAiQuota(db, { ...base, providerType: 'CUSTOM' })).resolves.toBeUndefined()
    expect(getQuotaStatus).not.toHaveBeenCalled()
    expect(consume).toHaveBeenCalledTimes(1)
  })

  it('fails open when no usage guard is available', async () => {
    createUsageGuard.mockResolvedValue(null)
    await expect(enforceAiQuota(db, { ...base, providerType: 'SYSTEM' })).resolves.toBeUndefined()
  })
})
