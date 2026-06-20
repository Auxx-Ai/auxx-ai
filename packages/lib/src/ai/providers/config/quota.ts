// packages/lib/src/ai/providers/config/quota.ts

import { UsageTrackingService } from '../../usage/usage-tracking-service'
import type { AiProviderCtx } from './context'

/**
 * Thin delegations to UsageTrackingService for the org's per-provider quota. The
 * UsageTrackingService is constructed inline from `ctx.db`.
 */

export async function getQuotaInfo(
  ctx: AiProviderCtx,
  provider: string
): Promise<{
  quotaType: string | null
  quotaUsed: number
  quotaLimit: number
  quotaPeriodStart: Date | null
  quotaPeriodEnd: Date | null
  usagePercentage: number
  isUnlimited: boolean
} | null> {
  return new UsageTrackingService(ctx.db).getQuotaInfo(ctx.organizationId, provider)
}

export async function getUsageStats(
  ctx: AiProviderCtx,
  provider: string,
  periodStart?: Date,
  periodEnd?: Date
): Promise<{
  totalTokens: number
  totalCost: number
  requestCount: number
  avgResponseTime: number
}> {
  return new UsageTrackingService(ctx.db).getUsageStats(
    ctx.organizationId,
    provider,
    periodStart,
    periodEnd
  )
}

export async function resetQuotaPeriod(
  ctx: AiProviderCtx,
  provider: string,
  newPeriodStart: Date,
  newPeriodEnd: Date
): Promise<void> {
  return new UsageTrackingService(ctx.db).resetQuotaPeriod(
    ctx.organizationId,
    provider,
    newPeriodStart,
    newPeriodEnd
  )
}
