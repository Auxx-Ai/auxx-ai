// packages/lib/src/ai/quota/enforce-ai-quota.ts

import type { Database } from '@auxx/database'
import { UsageLimitError } from '../../errors'
import { createUsageGuard } from '../../usage/create-usage-guard'
import { QuotaExceededError } from '../errors/quota-errors'
import { QuotaService } from './quota-service'

/** Input for {@link enforceAiQuota}; `providerType` is the credential tier the call resolved to. */
export interface EnforceAiQuotaInput {
  provider: string
  organizationId: string
  userId: string
  providerType: 'SYSTEM' | 'CUSTOM'
  forceSystem?: boolean
}

/**
 * Gate one AI call: the SYSTEM credit quota (throws QuotaExceededError), then the
 * `aiCompletions` rate limit for every tier (throws UsageLimitError). Consumes one unit.
 */
export async function enforceAiQuota(db: Database, input: EnforceAiQuotaInput): Promise<void> {
  const { provider, organizationId, userId, providerType, forceSystem } = input

  // forceSystem means SYSTEM creds were just forced, so the org owes credits for the call.
  if (forceSystem || providerType === 'SYSTEM') {
    const quota = new QuotaService(db, organizationId)
    const status = await quota.getQuotaStatus()
    if (status?.isExceeded) {
      throw new QuotaExceededError(
        "You're out of AI credits. They'll refill at the start of your next billing cycle.",
        {
          provider,
          quotaUsed: status.quotaUsed,
          quotaLimit: status.quotaLimit,
          bonusCredits: status.bonusCredits,
          resetsAt: status.quotaPeriodEnd,
        }
      )
    }
  }

  // Abuse-prevention rate limit: counts raw call rate, not credit cost.
  const guard = await createUsageGuard(db)
  if (guard) {
    const usageResult = await guard.consume(organizationId, 'aiCompletions', { userId })
    if (!usageResult.allowed) {
      throw new UsageLimitError({
        metric: 'aiCompletions',
        current: usageResult.current ?? 0,
        limit: usageResult.limit ?? 0,
        message:
          'AI request rate limit reached for this billing period. Please contact support if this is unexpected.',
      })
    }
  }
}
