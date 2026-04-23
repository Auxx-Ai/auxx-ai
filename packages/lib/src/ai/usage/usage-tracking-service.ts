// packages/lib/src/ai/usage/usage-tracking-service.ts

import { type Database, database as db, schema } from '@auxx/database'
import { isSelfHosted } from '@auxx/deployment'
import { and, count, eq, gte, lte, sql, sum } from 'drizzle-orm'
import type { UsageSource, UsageTrackingRequest } from '../orchestrator/types'
import { getModelCreditMultiplier } from '../quota/credit-multiplier'
import { QuotaService } from '../quota/quota-service'

/** Entry for usage grouped by day */
export interface UsageDayEntry {
  provider: string
  model: string
  modelType: string
  totalTokens: number
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
   * Check if organization has enough quota for a request.
   * Reads the org-level OrganizationAiQuota table (unified pool, not per-provider).
   */
  async checkQuotaAvailable(
    organizationId: string,
    _provider: string,
    estimatedCredits: number
  ): Promise<{ available: boolean; reason?: string }> {
    if (isSelfHosted()) return { available: true }

    const quota = new QuotaService(this.database, organizationId)
    const status = await quota.getQuotaStatus()
    if (!status) return { available: true }
    if (status.quotaLimit === -1) return { available: true }

    if (status.totalRemaining < estimatedCredits) {
      return {
        available: false,
        reason: `Insufficient quota. Need ${estimatedCredits}, have ${status.totalRemaining}`,
      }
    }
    return { available: true }
  }

  /**
   * Track actual usage after API call completion (Orchestrator interface).
   *
   * Credit cost per call = modelMultiplier (1/3/8) unless explicitly overridden.
   * SYSTEM calls decrement the org credit pool (monthly first, then bonus);
   * CUSTOM calls write the usage log only.
   */
  async trackUsage(request: UsageTrackingRequest): Promise<void> {
    const inputTokens = request.usage.prompt_tokens || 0
    const outputTokens = request.usage.completion_tokens || 0
    const totalTokens = request.usage.total_tokens || inputTokens + outputTokens
    const multiplier = getModelCreditMultiplier(request.provider, request.model)
    const creditsUsed = request.creditsUsed ?? multiplier

    await this.database.insert(schema.AiUsage).values({
      organizationId: request.organizationId,
      userId: request.userId,
      provider: request.provider,
      model: request.model,
      modelType: 'llm',
      inputTokens,
      outputTokens,
      totalTokens,
      cost: undefined,
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
   * deduct SYSTEM credits via `QuotaService.consumeCredits`. Same credit
   * accounting as `trackUsage`, just batched for efficiency (e.g. Kopilot
   * turns that aggregate multiple internal calls).
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
        creditsUsed: number
        ref: UsageTrackingRequest
      }
    >()

    for (const req of requests) {
      const key = `${req.provider}:${req.model}`
      const existing = grouped.get(key)
      const inputTokens = req.usage.prompt_tokens || 0
      const outputTokens = req.usage.completion_tokens || 0
      const multiplier = getModelCreditMultiplier(req.provider, req.model)
      const credits = req.creditsUsed ?? multiplier

      if (existing) {
        existing.inputTokens += inputTokens
        existing.outputTokens += outputTokens
        existing.creditsUsed += credits
      } else {
        grouped.set(key, { inputTokens, outputTokens, creditsUsed: credits, ref: req })
      }
    }

    const rows = [...grouped.values()].map(({ inputTokens, outputTokens, creditsUsed, ref }) => ({
      organizationId: ref.organizationId,
      userId: ref.userId,
      provider: ref.provider,
      model: ref.model,
      modelType: 'llm' as const,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      createdAt: ref.timestamp || new Date(),
      providerType: (ref.providerType ?? 'CUSTOM') as 'SYSTEM' | 'CUSTOM',
      credentialSource: (ref.credentialSource ?? 'CUSTOM') as
        | 'SYSTEM'
        | 'CUSTOM'
        | 'MODEL_SPECIFIC'
        | 'LOAD_BALANCED',
      creditsUsed,
      source: ref.source ?? 'other',
      sourceId: ref.sourceId ?? null,
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
