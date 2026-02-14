// packages/seed/src/domains/ai.domain.ts
// AI and analytics domain refinements for drizzle-seed with comprehensive AI data seeding

import { createId } from '@paralleldrive/cuid2'
import { sql } from 'drizzle-orm'
import type { SeedingContext, SeedingScenario } from '../types'
import { BusinessDistributions } from '../utils/business-distributions'

/** AiDomain encapsulates analytics-specific refinements. */
export class AiDomain {
  /** scenario stores the resolved scenario definition. */
  private readonly scenario: SeedingScenario
  /** distributions provides realistic business data patterns. */
  private readonly distributions: BusinessDistributions
  /** organizationId targets seeding to a specific organization. */
  private readonly targetOrganizationId?: string
  /** services caches organization references for foreign keys. */
  private readonly organizationIds: string[]
  /** users caches seeded users for tying AI usage events. */
  private readonly users: string[]
  /** cached token counts to keep arrays aligned. */
  private tokenTotals?: number[]
  /** cached input tokens array. */
  private tokenInputs?: number[]
  /** cached model sequence. */
  private modelSequence?: string[]

  /**
   * Creates a new AiDomain instance.
   * @param scenario - Scenario configuration controlling scale and quality.
   * @param context - Seeding context used for organization/user references.
   * @param options - Optional configuration for organization-scoped seeding.
   */
  constructor(
    scenario: SeedingScenario,
    context: SeedingContext,
    options?: { organizationId?: string }
  ) {
    this.scenario = scenario
    this.distributions = new BusinessDistributions(scenario.dataQuality)
    this.targetOrganizationId = options?.organizationId

    // Filter organizations by organizationId if specified
    const filteredOrgs = this.targetOrganizationId
      ? context.services.organizations.filter((o) => o.id === this.targetOrganizationId)
      : context.services.organizations

    this.organizationIds = filteredOrgs.map((org) => org.id)

    if (this.organizationIds.length === 0) {
      throw new Error(
        `AiDomain requires organization references${
          this.targetOrganizationId ? ` for organization ${this.targetOrganizationId}` : ''
        } from the seeding context`
      )
    }
    const userIds = new Set<string>()
    context.auth.testUsers.forEach((user) => userIds.add(user.id))
    context.auth.randomUsers.forEach((user) => userIds.add(user.id))
    this.users = Array.from(userIds)
    if (this.users.length === 0) {
      throw new Error('AiDomain requires user references from the seeding context')
    }
    console.log('🤖 AiDomain context', {
      usageCount: this.calculateAiUsageCount(),
      organizations: this.organizationIds.length,
      users: this.users.length,
    })
  }

  /**
   * insertDirectly performs direct database inserts bypassing drizzle-seed.
   * @param db - Drizzle database instance
   */
  async insertDirectly(db: any): Promise<void> {
    if (!this.scenario.features.aiAnalysis) {
      console.log('⏭️  AI analysis disabled, skipping')
      return
    }

    const { schema } = await import('@auxx/database')

    // Generate AI usage data
    console.log('🤖 Generating AI usage data...')
    const ids = this.generateUsageIds()
    const organizationIds = this.generateOrganizationAssignments()
    const userIds = this.generateUserAssignments()
    const providers = this.generateProviders()
    const models = this.generateAiModels()
    const modelTypes = this.generateModelTypes()
    const totalTokens = this.generateTokenCounts()
    const inputTokens = this.generateInputTokens()
    const outputTokens = this.generateOutputTokens()
    const costs = this.generateCosts()
    const endpoints = this.generateEndpoints()
    const createdAt = this.generateUsageTimestamps()
    const requestIds = this.generateRequestIds()
    const responseTimes = this.generateResponseTimes()

    // Insert AI usage records
    const usageRows = []
    const count = this.calculateAiUsageCount()
    for (let i = 0; i < count; i++) {
      usageRows.push({
        id: ids[i],
        organizationId: organizationIds[i],
        userId: userIds[i],
        provider: providers[i],
        model: models[i],
        modelType: modelTypes[i],
        totalTokens: totalTokens[i],
        inputTokens: inputTokens[i],
        outputTokens: outputTokens[i],
        cost: costs[i],
        endpoint: endpoints[i],
        createdAt: createdAt[i],
        requestId: requestIds[i],
        responseTime: responseTimes[i],
      })
    }

    if (usageRows.length > 0) {
      console.log(`📝 AI usage rows to insert: ${usageRows.length} records`)
      console.log(
        `  Sample: model=${usageRows[0]?.model}, tokens=${usageRows[0]?.totalTokens}, cost=$${usageRows[0]?.cost}`
      )

      await db
        .insert(schema.AiUsage)
        .values(usageRows)
        .onConflictDoUpdate({
          target: schema.AiUsage.id,
          set: {
            totalTokens: sql`excluded."totalTokens"`,
            inputTokens: sql`excluded."inputTokens"`,
            outputTokens: sql`excluded."outputTokens"`,
            cost: sql`excluded.cost`,
            responseTime: sql`excluded."responseTime"`,
          },
        })
      console.log(`✅ Upserted ${usageRows.length} AI usage records`)
    }
  }

  /** buildRefinements returns drizzle-seed refinements for AI entities (DEPRECATED - use insertDirectly). */
  buildRefinements(): (helpers: unknown) => Record<string, unknown> {
    return (helpers: any) => {
      if (!this.scenario.features.aiAnalysis) {
        return {}
      }
      const ids = this.generateUsageIds()
      const organizationIds = this.generateOrganizationAssignments()
      const userIds = this.generateUserAssignments()
      const providers = this.generateProviders()
      const models = this.generateAiModels()
      const modelTypes = this.generateModelTypes()
      const totalTokens = this.generateTokenCounts()
      const inputTokens = this.generateInputTokens()
      const outputTokens = this.generateOutputTokens()
      const costs = this.generateCosts()
      const endpoints = this.generateEndpoints()
      const createdAt = this.generateUsageTimestamps()
      const requestIds = this.generateRequestIds()
      const responseTimes = this.generateResponseTimes()

      const debugMap = {
        id: ids,
        organizationId: organizationIds,
        userId: userIds,
        provider: providers,
        model: models,
        modelType: modelTypes,
        totalTokens,
        inputTokens,
        outputTokens,
        cost: costs,
        endpoint: endpoints,
        createdAt,
        requestId: requestIds,
        responseTime: responseTimes,
      }

      Object.entries(debugMap).forEach(([key, value]) => {
        console.log(`   ↳ AiUsage.${key}: ${value.length}`)
      })

      const result = {
        AiUsage: {
          count: this.calculateAiUsageCount(),
          columns: {
            id: helpers.valuesFromArray({ values: ids }),
            organizationId: helpers.valuesFromArray({ values: organizationIds }),
            userId: helpers.valuesFromArray({ values: userIds }),
            provider: helpers.valuesFromArray({ values: providers }),
            model: helpers.valuesFromArray({ values: models }),
            modelType: helpers.valuesFromArray({ values: modelTypes }),
            totalTokens: helpers.valuesFromArray({ values: totalTokens }),
            inputTokens: helpers.valuesFromArray({ values: inputTokens }),
            outputTokens: helpers.valuesFromArray({ values: outputTokens }),
            cost: helpers.valuesFromArray({ values: costs }),
            endpoint: helpers.valuesFromArray({ values: endpoints }),
            createdAt: helpers.valuesFromArray({ values: createdAt }),
            requestId: helpers.valuesFromArray({ values: requestIds }),
            responseTime: helpers.valuesFromArray({ values: responseTimes }),
          },
        },
      }
      console.log('🤖 AI refinements prepared: AiUsage', this.calculateAiUsageCount())
      return result
    }
  }

  // ---- AI Generator Methods ----

  /** calculateAiUsageCount determines total AI usage records needed. */
  private calculateAiUsageCount(): number {
    return this.scenario.scales.organizations * 100 // 100 AI calls per org
  }

  /** generateAiModels creates realistic AI model distribution. */
  private generateAiModels(): string[] {
    if (this.modelSequence) {
      return this.modelSequence
    }
    const models = ['gpt-4', 'gpt-3.5-turbo', 'claude-3', 'claude-2']
    const result: string[] = []
    const count = this.calculateAiUsageCount()
    for (let i = 0; i < count; i++) {
      if (i % 100 < 40) result.push(models[0]!)
      else if (i % 100 < 75) result.push(models[1]!)
      else if (i % 100 < 90) result.push(models[2]!)
      else result.push(models[3]!)
    }
    this.modelSequence = result
    return result
  }

  /** generateTokenCounts creates realistic token usage. */
  private generateTokenCounts(): number[] {
    if (this.tokenTotals) {
      return this.tokenTotals
    }
    const tokens: number[] = []
    const count = this.calculateAiUsageCount()
    for (let i = 0; i < count; i++) {
      const usageType = i % 4
      if (usageType === 0) tokens.push(this.distributions.generateValueInRange(100, 500, i))
      else if (usageType === 1) tokens.push(this.distributions.generateValueInRange(500, 1500, i))
      else if (usageType === 2) tokens.push(this.distributions.generateValueInRange(1500, 4000, i))
      else tokens.push(this.distributions.generateValueInRange(50, 200, i))
    }
    this.tokenTotals = tokens
    return tokens
  }

  /** generateCosts creates realistic API costs in cents. */
  private generateCosts(): number[] {
    const costs: number[] = []
    const tokens = this.generateTokenCounts()
    const models = this.generateAiModels()
    const pricing = new Map<string, number>([
      ['gpt-4', 3],
      ['gpt-3.5-turbo', 0.2],
      ['claude-3', 1.5],
      ['claude-2', 1.1],
    ])
    for (let i = 0; i < tokens.length; i++) {
      const tokenCount = tokens[i]!
      const model = models[i]!
      const costPer1K = pricing.get(model) ?? 1
      const cost = Math.round((tokenCount / 1000) * costPer1K * 100)
      costs.push(cost)
    }
    return costs
  }

  /** generateProviders creates AI provider distribution. */
  private generateProviders(): string[] {
    const providers = ['openai', 'anthropic', 'azure']
    const result: string[] = []
    const count = this.calculateAiUsageCount()
    for (let i = 0; i < count; i++) {
      if (i % 100 < 60) result.push('openai')
      else if (i % 100 < 85) result.push('anthropic')
      else result.push('azure')
    }
    return result
  }

  /** generateInputTokens creates realistic input token counts. */
  private generateInputTokens(): number[] {
    if (this.tokenInputs) {
      return this.tokenInputs
    }
    const tokens: number[] = []
    const totalTokens = this.generateTokenCounts()
    for (let i = 0; i < totalTokens.length; i++) {
      const total = totalTokens[i]!
      const inputRatio = 0.6 + (i % 10) * 0.04 // 60-96% input ratio
      tokens.push(Math.round(total * inputRatio))
    }
    this.tokenInputs = tokens
    return tokens
  }

  /** generateEndpoints creates realistic API endpoints. */
  private generateEndpoints(): string[] {
    const endpoints = [
      '/v1/chat/completions',
      '/v1/completions',
      '/v1/embeddings',
      '/v1/messages',
      '/openai/deployments/gpt-4/chat/completions',
    ]
    const result: string[] = []
    const count = this.calculateAiUsageCount()
    for (let i = 0; i < count; i++) {
      result.push(endpoints[i % endpoints.length]!)
    }
    return result
  }

  /** getSeededStartDate returns a consistent start date for seeded data. */
  private getSeededStartDate(): Date {
    const now = new Date()
    return new Date(now.getFullYear() - 1, 0, 1) // One year ago
  }

  private generateUsageIds(): string[] {
    return Array.from({ length: this.calculateAiUsageCount() }, () => createId())
  }

  private generateOrganizationAssignments(): string[] {
    const orgs = this.organizationIds
    const count = this.calculateAiUsageCount()
    return Array.from({ length: count }, (_, index) => orgs[index % orgs.length]!)
  }

  private generateUserAssignments(): Array<string | null> {
    const count = this.calculateAiUsageCount()
    return Array.from({ length: count }, (_, index) =>
      index % 8 === 0 ? null : this.users[index % this.users.length]!
    )
  }

  private generateModelTypes(): string[] {
    return Array(this.calculateAiUsageCount()).fill('llm')
  }

  private generateOutputTokens(): number[] {
    const totals = this.generateTokenCounts()
    const inputs = this.generateInputTokens()
    return totals.map((total, index) => Math.max(total - inputs[index]!, 0))
  }

  private generateUsageTimestamps(): Date[] {
    const base = this.getSeededStartDate().getTime()
    return Array.from(
      { length: this.calculateAiUsageCount() },
      (_, index) => new Date(base + index * 3600 * 1000)
    )
  }

  private generateRequestIds(): string[] {
    return Array.from({ length: this.calculateAiUsageCount() }, (_, index) => `req-${index + 1}`)
  }

  private generateResponseTimes(): number[] {
    return Array.from({ length: this.calculateAiUsageCount() }, (_, index) =>
      this.distributions.generateValueInRange(200, 1200, index)
    )
  }
}
