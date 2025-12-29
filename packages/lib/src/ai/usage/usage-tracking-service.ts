// packages/lib/src/ai/usage/usage-tracking-service.ts

import { database as db, schema, type Database } from '@auxx/database'
import { eq, and, sql, sum, count, gte, lte, isNotNull } from 'drizzle-orm'
import type { UsageTrackingRequest, UsageSource } from '../orchestrator/types'

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
   * Check if organization has enough quota for a request
   */
  async checkQuotaAvailable(
    organizationId: string,
    provider: string,
    estimatedTokens: number
  ): Promise<{ available: boolean; reason?: string }> {
    const config = await this.database.query.ProviderConfiguration.findFirst({
      where: and(
        eq(schema.ProviderConfiguration.organizationId, organizationId),
        eq(schema.ProviderConfiguration.provider, provider)
      ),
      columns: {
        quotaUsed: true,
        quotaLimit: true,
        quotaType: true,
        quotaPeriodEnd: true,
      },
    })

    if (!config || config.quotaLimit === -1) {
      return { available: true } // Unlimited quota
    }

    // Check if quota period has expired
    if (config.quotaPeriodEnd && new Date() > new Date(config.quotaPeriodEnd)) {
      return {
        available: false,
        reason: 'Quota period has expired',
      }
    }

    const remainingQuota = config.quotaLimit - config.quotaUsed
    if (remainingQuota < estimatedTokens) {
      return {
        available: false,
        reason: `Insufficient quota. Need ${estimatedTokens}, have ${remainingQuota}`,
      }
    }

    return { available: true }
  }

  /**
   * Track actual usage after API call completion (Orchestrator interface)
   */
  async trackUsage(request: UsageTrackingRequest): Promise<void> {
    const inputTokens = request.usage.prompt_tokens || 0
    const outputTokens = request.usage.completion_tokens || 0
    const totalTokens = request.usage.total_tokens || inputTokens + outputTokens
    const creditsUsed = request.creditsUsed ?? 1 // Default to 1 credit per invocation

    await this.database.transaction(async (tx) => {
      // 1. Create usage log entry with provider type and credential source
      await tx.insert(schema.AiUsage).values({
        organizationId: request.organizationId,
        userId: request.userId,
        provider: request.provider,
        model: request.model,
        modelType: 'llm', // Default to LLM type
        inputTokens,
        outputTokens,
        totalTokens,
        cost: undefined, // Would need to calculate based on provider pricing
        endpoint: undefined,
        requestId: undefined,
        responseTime: undefined,
        createdAt: request.timestamp || new Date(),
        // New fields for credential tracking
        providerType: request.providerType ?? 'CUSTOM',
        credentialSource: request.credentialSource ?? 'CUSTOM',
        creditsUsed,
        // Source tracking fields
        source: request.source ?? 'other',
        sourceId: request.sourceId ?? null,
      })

      // 2. Only update quota for SYSTEM provider type (credit-based)
      if (request.providerType === 'SYSTEM') {
        await tx
          .update(schema.ProviderConfiguration)
          .set({
            quotaUsed: sql`${schema.ProviderConfiguration.quotaUsed} + ${creditsUsed}`,
          })
          .where(
            and(
              eq(schema.ProviderConfiguration.organizationId, request.organizationId),
              eq(schema.ProviderConfiguration.provider, request.provider),
              eq(schema.ProviderConfiguration.providerType, 'SYSTEM'),
              isNotNull(schema.ProviderConfiguration.quotaType)
            )
          )
      }
    })
  }

  /**
   * Track actual usage after API call completion (Legacy interface - for direct calls)
   */
  async trackUsageLegacy(params: {
    organizationId: string
    userId?: string
    provider: string
    model: string
    modelType: string
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cost?: number
    endpoint?: string
    requestId?: string
    responseTime?: number
  }): Promise<void> {
    await this.database.transaction(async (tx) => {
      // 1. Create usage log entry
      await tx.insert(schema.AiUsage).values({
        organizationId: params.organizationId,
        userId: params.userId,
        provider: params.provider,
        model: params.model,
        modelType: params.modelType,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        totalTokens: params.totalTokens,
        cost: params.cost,
        endpoint: params.endpoint,
        requestId: params.requestId,
        responseTime: params.responseTime,
      })

      // 2. Update provider configuration quota
      await tx
        .update(schema.ProviderConfiguration)
        .set({
          quotaUsed: sql`${schema.ProviderConfiguration.quotaUsed} + ${params.totalTokens}`,
        })
        .where(
          and(
            eq(schema.ProviderConfiguration.organizationId, params.organizationId),
            eq(schema.ProviderConfiguration.provider, params.provider),
            isNotNull(schema.ProviderConfiguration.quotaType)
          )
        )
    })
  }

  /**
   * Reset quota for a new period (called by cron job)
   */
  async resetQuotaPeriod(
    organizationId: string,
    provider: string,
    newPeriodStart: Date,
    newPeriodEnd: Date
  ): Promise<void> {
    await this.database
      .update(schema.ProviderConfiguration)
      .set({
        quotaUsed: 0,
        quotaPeriodStart: newPeriodStart,
        quotaPeriodEnd: newPeriodEnd,
      })
      .where(
        and(
          eq(schema.ProviderConfiguration.organizationId, organizationId),
          eq(schema.ProviderConfiguration.provider, provider)
        )
      )
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
   * Get quota information for a provider
   */
  async getQuotaInfo(
    organizationId: string,
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
    const config = await this.database.query.ProviderConfiguration.findFirst({
      where: and(
        eq(schema.ProviderConfiguration.organizationId, organizationId),
        eq(schema.ProviderConfiguration.provider, provider)
      ),
      columns: {
        quotaType: true,
        quotaUsed: true,
        quotaLimit: true,
        quotaPeriodStart: true,
        quotaPeriodEnd: true,
      },
    })

    if (!config) return null

    const isUnlimited = config.quotaLimit === -1
    const usagePercentage = isUnlimited
      ? 0
      : Math.round((config.quotaUsed / config.quotaLimit) * 100)

    return {
      quotaType: config.quotaType,
      quotaUsed: config.quotaUsed,
      quotaLimit: config.quotaLimit,
      quotaPeriodStart: config.quotaPeriodStart ? new Date(config.quotaPeriodStart) : null,
      quotaPeriodEnd: config.quotaPeriodEnd ? new Date(config.quotaPeriodEnd) : null,
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
