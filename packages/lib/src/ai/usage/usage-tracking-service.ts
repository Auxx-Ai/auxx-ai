// packages/lib/src/ai/usage/usage-tracking-service.ts

import { type Database, database as db, schema } from '@auxx/database'
import { isSelfHosted } from '@auxx/deployment'
import { and, count, eq, gte, lte, sql, sum } from 'drizzle-orm'
import { createScopedLogger } from '../../logger'
import type { UsageSource, UsageTrackingRequest } from '../orchestrator/types'
import { UNPRICED_FALLBACK_CREDITS, usdToCredits } from '../quota/credit-conversion'
import { estimateUsageCostUsd } from '../quota/estimate-cost'
import { QuotaService } from '../quota/quota-service'

const logger = createScopedLogger('usage-tracking-service')

/**
 * Resolve credits charged for one SYSTEM call. BYO/CUSTOM calls charge 0.
 * SYSTEM calls meter actual USD COGS → credits, unless the caller passes an
 * explicit `creditsUsed` (the escape hatch for non-token-metered calls such as
 * audio transcription, which providers price per minute, not per token).
 * An unpriced SYSTEM model falls back to a defensive flat charge + error log —
 * it should have been filtered out of the SYSTEM-eligible set upstream.
 */
function resolveCreditsCharged(
  providerType: string | undefined,
  override: number | undefined,
  costUsd: number | undefined,
  provider: string,
  model: string
): number {
  if (providerType !== 'SYSTEM') return 0
  if (override !== undefined) return override
  if (costUsd !== undefined) return usdToCredits(costUsd)
  logger.error('Charging fallback credits for unpriced SYSTEM model', { provider, model })
  return UNPRICED_FALLBACK_CREDITS
}

/** Entry for usage grouped by day */
export interface UsageDayEntry {
  provider: string
  model: string
  modelType: string
  totalTokens: number
  /** Credits actually charged (0 for CUSTOM/BYO rows). */
  creditsUsed: number
  source: string
  sourceId: string | null
  runCount: number
}

/** Response shape for getUsageStatsByPeriod */
export interface UsageStatsByPeriodResponse {
  statisticsByDay: Record<string, UsageDayEntry[]>
  totalUsageForPeriod: UsageDayEntry[]
  periodStartAt: Date
  periodEndAt: Date
}

export type { UsageSource }

/**
 * Service for tracking AI provider usage and enforcing quotas
 */
export class UsageTrackingService {
  constructor(private database: Database = db) {}

  /**
   * Soft-landing turn-start check: does the org have any quota left (monthly or
   * bonus)? There is no per-call pre-check or reservation — a run that starts
   * with a positive balance always finishes, and overdraft accrues afterward.
   */
  async checkQuotaAvailable(
    organizationId: string,
    _provider: string
  ): Promise<{ available: boolean; reason?: string }> {
    if (isSelfHosted()) return { available: true }

    const quota = new QuotaService(this.database, organizationId)
    const available = await quota.hasAvailableQuota()
    return available
      ? { available: true }
      : { available: false, reason: 'AI credit quota exhausted' }
  }

  /**
   * Track actual usage after API call completion (Orchestrator interface).
   *
   * Credits = USD COGS metered from real token usage (`estimateUsageCostUsd`
   * → `usdToCredits`). SYSTEM calls decrement the org credit pool (monthly
   * first, then bonus, then overdraft on `quotaUsed`); CUSTOM/BYO calls write
   * the usage log only and charge 0.
   */
  async trackUsage(request: UsageTrackingRequest): Promise<void> {
    const inputTokens = request.usage.prompt_tokens || 0
    const outputTokens = request.usage.completion_tokens || 0
    const totalTokens = request.usage.total_tokens || inputTokens + outputTokens
    const cost = estimateUsageCostUsd(request.provider, request.model, request.usage)
    const creditsUsed = resolveCreditsCharged(
      request.providerType,
      request.creditsUsed,
      cost,
      request.provider,
      request.model
    )

    await this.database.insert(schema.AiUsage).values({
      organizationId: request.organizationId,
      userId: request.userId,
      provider: request.provider,
      model: request.model,
      modelType: 'llm',
      inputTokens,
      outputTokens,
      totalTokens,
      cachedInputTokens: request.usage.cached_input_tokens || 0,
      cacheWriteTokens: request.usage.cache_write_tokens || 0,
      cost,
      endpoint: undefined,
      requestId: undefined,
      responseTime: undefined,
      createdAt: request.timestamp || new Date(),
      providerType: request.providerType ?? 'CUSTOM',
      credentialSource: request.credentialSource ?? 'CUSTOM',
      creditsUsed,
      source: request.source ?? 'other',
      sourceId: request.sourceId ?? null,
    })

    if (request.providerType === 'SYSTEM' && creditsUsed > 0) {
      await new QuotaService(this.database, request.organizationId).consumeCredits(creditsUsed)
    }
  }

  /**
   * Batch-insert multiple usage entries in a single multi-row INSERT, then
   * deduct SYSTEM credits via `QuotaService.consumeCredits`. Credits are
   * metered from the **summed** USD COGS per provider+model group, rounded
   * once — so a batch of tiny calls isn't zeroed out call-by-call. Used by
   * agent/Kopilot turns that aggregate multiple internal LLM calls.
   *
   * Fire-and-forget — caller should catch errors externally.
   */
  async trackUsageBatch(requests: UsageTrackingRequest[]): Promise<void> {
    if (requests.length === 0) return

    // Aggregate entries by provider+model into a single row per combination.
    const grouped = new Map<
      string,
      {
        inputTokens: number
        outputTokens: number
        cachedInputTokens: number
        cacheWriteTokens: number
        cost: number
        hasCost: boolean
        creditsUsed: number
        ref: UsageTrackingRequest
      }
    >()

    for (const req of requests) {
      const key = `${req.provider}:${req.model}`
      const existing = grouped.get(key)
      const inputTokens = req.usage.prompt_tokens || 0
      const outputTokens = req.usage.completion_tokens || 0
      const cachedInputTokens = req.usage.cached_input_tokens || 0
      const cacheWriteTokens = req.usage.cache_write_tokens || 0
      const callCost = estimateUsageCostUsd(req.provider, req.model, req.usage)

      if (existing) {
        existing.inputTokens += inputTokens
        existing.outputTokens += outputTokens
        existing.cachedInputTokens += cachedInputTokens
        existing.cacheWriteTokens += cacheWriteTokens
        if (callCost !== undefined) {
          existing.cost += callCost
          existing.hasCost = true
        }
      } else {
        grouped.set(key, {
          inputTokens,
          outputTokens,
          cachedInputTokens,
          cacheWriteTokens,
          cost: callCost ?? 0,
          hasCost: callCost !== undefined,
          creditsUsed: 0,
          ref: req,
        })
      }
    }

    // Round metered USD → credits once per group (after summing) so sub-credit
    // calls accumulate instead of flooring to 0 individually.
    for (const g of grouped.values()) {
      g.creditsUsed = resolveCreditsCharged(
        g.ref.providerType,
        g.ref.creditsUsed,
        g.hasCost ? g.cost : undefined,
        g.ref.provider,
        g.ref.model
      )
    }

    const rows = [...grouped.values()].map((g) => ({
      organizationId: g.ref.organizationId,
      userId: g.ref.userId,
      provider: g.ref.provider,
      model: g.ref.model,
      modelType: 'llm' as const,
      inputTokens: g.inputTokens,
      outputTokens: g.outputTokens,
      totalTokens: g.inputTokens + g.outputTokens,
      cachedInputTokens: g.cachedInputTokens,
      cacheWriteTokens: g.cacheWriteTokens,
      cost: g.hasCost ? g.cost : undefined,
      createdAt: g.ref.timestamp || new Date(),
      providerType: (g.ref.providerType ?? 'CUSTOM') as 'SYSTEM' | 'CUSTOM',
      credentialSource: (g.ref.credentialSource ?? 'CUSTOM') as
        | 'SYSTEM'
        | 'CUSTOM'
        | 'MODEL_SPECIFIC'
        | 'LOAD_BALANCED',
      creditsUsed: g.creditsUsed,
      source: g.ref.source ?? 'other',
      sourceId: g.ref.sourceId ?? null,
    }))

    await this.database.insert(schema.AiUsage).values(rows)

    // Deduct credits from org-level quota for SYSTEM rows, one org at a time.
    const perOrgTotals = new Map<string, number>()
    for (const row of rows) {
      if (row.providerType !== 'SYSTEM' || row.creditsUsed <= 0) continue
      perOrgTotals.set(
        row.organizationId,
        (perOrgTotals.get(row.organizationId) ?? 0) + row.creditsUsed
      )
    }
    for (const [organizationId, total] of perOrgTotals.entries()) {
      const quota = new QuotaService(this.database, organizationId)
      await quota.consumeCredits(total)
    }
  }

  /**
   * Reset quota for a new period (called by cron job).
   * Operates on the org-level OrganizationAiQuota table.
   */
  async resetQuotaPeriod(
    organizationId: string,
    _provider: string,
    newPeriodStart: Date,
    newPeriodEnd: Date
  ): Promise<void> {
    await this.database
      .update(schema.OrganizationAiQuota)
      .set({
        quotaUsed: 0,
        quotaPeriodStart: newPeriodStart,
        quotaPeriodEnd: newPeriodEnd,
      })
      .where(eq(schema.OrganizationAiQuota.organizationId, organizationId))
  }

  /**
   * Get usage statistics for a provider
   */
  async getUsageStats(
    organizationId: string,
    provider: string,
    periodStart?: Date,
    periodEnd?: Date
  ): Promise<{
    totalTokens: number
    totalCost: number
    requestCount: number
    avgResponseTime: number
  }> {
    const whereConditions = [
      eq(schema.AiUsage.organizationId, organizationId),
      eq(schema.AiUsage.provider, provider),
    ]

    if (periodStart) {
      whereConditions.push(gte(schema.AiUsage.createdAt, periodStart))
    }
    if (periodEnd) {
      whereConditions.push(lte(schema.AiUsage.createdAt, periodEnd))
    }

    const stats = await this.database
      .select({
        totalTokens: sum(schema.AiUsage.totalTokens),
        totalCost: sum(schema.AiUsage.cost),
        responseTimeSum: sum(schema.AiUsage.responseTime),
        requestCount: count(schema.AiUsage.id),
      })
      .from(schema.AiUsage)
      .where(and(...whereConditions))
      .then((rows) => rows[0])

    const totalTokens = Number(stats?.totalTokens) || 0
    const totalCost = Number(stats?.totalCost) || 0
    const requestCount = Number(stats?.requestCount) || 0
    const responseTimeSum = Number(stats?.responseTimeSum) || 0

    return {
      totalTokens,
      totalCost,
      requestCount,
      avgResponseTime: requestCount > 0 ? Math.round(responseTimeSum / requestCount) : 0,
    }
  }

  /**
   * Get quota information for the organization (provider arg ignored — quota is org-level).
   */
  async getQuotaInfo(
    organizationId: string,
    _provider: string
  ): Promise<{
    quotaType: string | null
    quotaUsed: number
    quotaLimit: number
    quotaPeriodStart: Date | null
    quotaPeriodEnd: Date | null
    usagePercentage: number
    isUnlimited: boolean
  } | null> {
    const row = await this.database.query.OrganizationAiQuota.findFirst({
      where: eq(schema.OrganizationAiQuota.organizationId, organizationId),
    })
    if (!row) return null

    const isUnlimited = row.quotaLimit === -1
    const usagePercentage = isUnlimited
      ? 0
      : row.quotaLimit > 0
        ? Math.round((row.quotaUsed / row.quotaLimit) * 100)
        : 0

    return {
      quotaType: row.quotaType,
      quotaUsed: row.quotaUsed,
      quotaLimit: row.quotaLimit,
      quotaPeriodStart: row.quotaPeriodStart,
      quotaPeriodEnd: row.quotaPeriodEnd,
      usagePercentage,
      isUnlimited,
    }
  }

  /**
   * Get usage statistics grouped by day for a given period
   * Used for the AI usage analytics dialog
   */
  async getUsageStatsByPeriod(
    organizationId: string,
    options: {
      days?: number // 7, 30, 90. If not provided, uses periodStart/periodEnd
      periodStart?: Date
      periodEnd?: Date
    }
  ): Promise<UsageStatsByPeriodResponse> {
    const now = new Date()
    let startDate: Date
    let endDate: Date = now

    // Determine date range
    if (options.days) {
      startDate = new Date(now)
      startDate.setDate(startDate.getDate() - options.days)
    } else if (options.periodStart) {
      startDate = options.periodStart
      endDate = options.periodEnd ?? now
    } else {
      // Fallback: last 30 days
      startDate = new Date(now)
      startDate.setDate(startDate.getDate() - 30)
    }

    // Query: Group by date, provider, model, modelType, source
    const results = await this.database
      .select({
        date: sql<string>`DATE(${schema.AiUsage.createdAt})`.as('date'),
        provider: schema.AiUsage.provider,
        model: schema.AiUsage.model,
        modelType: schema.AiUsage.modelType,
        source: schema.AiUsage.source,
        sourceId: schema.AiUsage.sourceId,
        totalTokens: sum(schema.AiUsage.totalTokens).as('totalTokens'),
        creditsUsed: sum(schema.AiUsage.creditsUsed).as('creditsUsed'),
        runCount: count(schema.AiUsage.id).as('runCount'),
      })
      .from(schema.AiUsage)
      .where(
        and(
          eq(schema.AiUsage.organizationId, organizationId),
          gte(schema.AiUsage.createdAt, startDate),
          lte(schema.AiUsage.createdAt, endDate)
        )
      )
      .groupBy(
        sql`DATE(${schema.AiUsage.createdAt})`,
        schema.AiUsage.provider,
        schema.AiUsage.model,
        schema.AiUsage.modelType,
        schema.AiUsage.source,
        schema.AiUsage.sourceId
      )
      .orderBy(sql`DATE(${schema.AiUsage.createdAt})`)

    // Transform results into statisticsByDay map
    const statisticsByDay: Record<string, UsageDayEntry[]> = {}
    const totalAggregation: Map<string, UsageDayEntry> = new Map()

    for (const row of results) {
      const dateKey = row.date // Already a string like "2025-12-09"

      const entry: UsageDayEntry = {
        provider: row.provider,
        model: row.model,
        modelType: row.modelType,
        source: row.source ?? 'other',
        sourceId: row.sourceId,
        totalTokens: Number(row.totalTokens) || 0,
        creditsUsed: Number(row.creditsUsed) || 0,
        runCount: Number(row.runCount) || 0,
      }

      // Add to daily stats
      if (!statisticsByDay[dateKey]) {
        statisticsByDay[dateKey] = []
      }
      statisticsByDay[dateKey].push(entry)

      // Aggregate for total (group by provider/model/modelType/source)
      const totalKey = `${row.provider}|${row.model}|${row.modelType}|${row.source}`
      const existing = totalAggregation.get(totalKey)
      if (existing) {
        existing.totalTokens += entry.totalTokens
        existing.creditsUsed += entry.creditsUsed
        existing.runCount += entry.runCount
      } else {
        totalAggregation.set(totalKey, { ...entry })
      }
    }

    return {
      statisticsByDay,
      totalUsageForPeriod: Array.from(totalAggregation.values()),
      periodStartAt: startDate,
      periodEndAt: endDate,
    }
  }
}
