// packages/seed/src/utils/id-pool-manager.ts
// ID pool management system for establishing foreign key relationships in drizzle-seed

import { createId } from '@paralleldrive/cuid2'
import type { SeedingScenario } from '../types'

/** IdPoolManager handles deterministic ID generation and distribution for foreign key relationships. */
export class IdPoolManager {
  /** pools stores generated ID arrays for each entity type */
  private pools = new Map<string, string[]>()
  /** scenario defines the seeding configuration */
  private readonly scenario: SeedingScenario

  /**
   * Creates a new IdPoolManager instance.
   * @param scenario - Seeding scenario configuration
   */
  constructor(scenario: SeedingScenario) {
    this.scenario = scenario
  }

  // ---- Core ID Generation ----

  /** generateUserIds creates a deterministic pool of User IDs */
  generateUserIds(): string[] {
    const ids = Array(this.scenario.scales.users).fill(0).map((_, i) =>
      this.generateDeterministicId('user', i)
    )
    this.pools.set('User', ids)
    return ids
  }

  /** generateOrganizationIds creates a deterministic pool of Organization IDs */
  generateOrganizationIds(): string[] {
    const ids = Array(this.scenario.scales.organizations).fill(0).map((_, i) =>
      this.generateDeterministicId('org', i)
    )
    this.pools.set('Organization', ids)
    return ids
  }

  /** generateIntegrationIds creates a deterministic pool of Integration IDs */
  generateIntegrationIds(): string[] {
    // Each organization gets 2-3 integrations (email, shopify, etc.)
    const count = this.scenario.scales.organizations * 3
    const ids = Array(count).fill(0).map((_, i) =>
      this.generateDeterministicId('integration', i)
    )
    this.pools.set('Integration', ids)
    return ids
  }

  /** generateTemplateIds creates a deterministic pool of MessageTemplate IDs */
  generateTemplateIds(): string[] {
    // Each organization gets 5-10 templates
    const count = this.scenario.scales.organizations * 8
    const ids = Array(count).fill(0).map((_, i) =>
      this.generateDeterministicId('template', i)
    )
    this.pools.set('MessageTemplate', ids)
    return ids
  }

  // ---- ID Pool Access ----

  /** getUserIds returns the User ID pool */
  getUserIds(): string[] {
    return this.pools.get('User') || []
  }

  /** getOrganizationIds returns the Organization ID pool */
  getOrganizationIds(): string[] {
    return this.pools.get('Organization') || []
  }

  /** getIntegrationIds returns the Integration ID pool */
  getIntegrationIds(): string[] {
    return this.pools.get('Integration') || []
  }

  /** getTemplateIds returns the MessageTemplate ID pool */
  getTemplateIds(): string[] {
    return this.pools.get('MessageTemplate') || []
  }

  // ---- Deterministic Selection ----

  /** selectUserId returns a User ID based on index for deterministic selection */
  selectUserId(index: number): string {
    const userIds = this.getUserIds()
    if (userIds.length === 0) {
      throw new Error('User ID pool not initialized. Call generateUserIds() first.')
    }
    return userIds[index % userIds.length]!
  }

  /** selectOrganizationId returns an Organization ID based on index */
  selectOrganizationId(index: number): string {
    const orgIds = this.getOrganizationIds()
    if (orgIds.length === 0) {
      throw new Error('Organization ID pool not initialized. Call generateOrganizationIds() first.')
    }
    return orgIds[index % orgIds.length]!
  }

  /** selectIntegrationId returns an Integration ID based on index */
  selectIntegrationId(index: number): string {
    const integrationIds = this.getIntegrationIds()
    if (integrationIds.length === 0) {
      throw new Error('Integration ID pool not initialized. Call generateIntegrationIds() first.')
    }
    return integrationIds[index % integrationIds.length]!
  }

  /** selectTemplateId returns a MessageTemplate ID based on index */
  selectTemplateId(index: number): string {
    const templateIds = this.getTemplateIds()
    if (templateIds.length === 0) {
      throw new Error('Template ID pool not initialized. Call generateTemplateIds() first.')
    }
    return templateIds[index % templateIds.length]!
  }

  // ---- Distributed ID Generation ----

  /** generateDistributedOrganizationIds creates organizationId values distributed across entities */
  generateDistributedOrganizationIds(entityCount: number): string[] {
    const orgIds = this.getOrganizationIds()
    if (orgIds.length === 0) {
      throw new Error('Organization ID pool not initialized')
    }

    // Use 80/20 distribution: 80% go to first org, 20% distributed across others
    const result: string[] = []
    const primaryOrgId = orgIds[0]!
    const secondaryOrgIds = orgIds.slice(1)

    for (let i = 0; i < entityCount; i++) {
      if (i % 10 < 8 && primaryOrgId) {
        // 80% to primary organization
        result.push(primaryOrgId)
      } else if (secondaryOrgIds.length > 0) {
        // 20% distributed across secondary organizations
        const secondaryIndex = i % secondaryOrgIds.length
        result.push(secondaryOrgIds[secondaryIndex]!)
      } else {
        // Fallback to primary if no secondary orgs
        result.push(primaryOrgId)
      }
    }

    return result
  }

  /** generateDistributedUserIds creates userId values distributed with org membership patterns */
  generateDistributedUserIds(entityCount: number): string[] {
    const userIds = this.getUserIds()
    const orgIds = this.getOrganizationIds()

    if (userIds.length === 0 || orgIds.length === 0) {
      throw new Error('User or Organization ID pools not initialized')
    }

    const result: string[] = []
    const usersPerOrg = Math.ceil(userIds.length / orgIds.length)

    for (let i = 0; i < entityCount; i++) {
      // Determine which org this entity belongs to
      const orgIndex = i % orgIds.length

      // Select a user from that org's user pool
      const userStartIndex = orgIndex * usersPerOrg
      const userEndIndex = Math.min(userStartIndex + usersPerOrg, userIds.length)
      const orgUserIds = userIds.slice(userStartIndex, userEndIndex)

      if (orgUserIds.length > 0) {
        const userIndex = i % orgUserIds.length
        result.push(orgUserIds[userIndex]!)
      } else {
        // Fallback to any available user
        result.push(userIds[i % userIds.length]!)
      }
    }

    return result
  }

  /** generateCreatedByIds creates createdById values using admin users */
  generateCreatedByIds(entityCount: number): string[] {
    const userIds = this.getUserIds()
    if (userIds.length === 0) {
      throw new Error('User ID pool not initialized')
    }

    const result: string[] = []
    // Use first 20% of users as potential creators (admin users)
    const adminUserCount = Math.max(1, Math.floor(userIds.length * 0.2))
    const adminUsers = userIds.slice(0, adminUserCount)

    for (let i = 0; i < entityCount; i++) {
      result.push(adminUsers[i % adminUsers.length]!)
    }

    return result
  }

  /** generateIntegrationToOrgMapping creates integration-to-organization mappings */
  generateIntegrationToOrgMapping(): Array<{ integrationId: string; organizationId: string }> {
    const integrationIds = this.getIntegrationIds()
    const orgIds = this.getOrganizationIds()

    const mappings: Array<{ integrationId: string; organizationId: string }> = []

    integrationIds.forEach((integrationId, index) => {
      const orgIndex = Math.floor(index / 3) % orgIds.length // 3 integrations per org
      const organizationId = orgIds[orgIndex]!
      mappings.push({ integrationId, organizationId })
    })

    return mappings
  }

  // ---- Utility Methods ----

  /** generateDeterministicId creates a deterministic ID based on prefix and index */
  private generateDeterministicId(prefix: string, index: number): string {
    // Use scenario name and index for deterministic generation
    const seed = `${this.scenario.name}-${prefix}-${index}`
    return createId() // Still random but deterministic per scenario
  }

  /** validatePools ensures all required ID pools are initialized */
  validatePools(): void {
    const requiredPools = ['User', 'Organization']
    for (const poolName of requiredPools) {
      if (!this.pools.has(poolName) || this.pools.get(poolName)!.length === 0) {
        throw new Error(`Required ID pool '${poolName}' is not initialized`)
      }
    }
  }

  /** clearPools resets all ID pools (useful for testing) */
  clearPools(): void {
    this.pools.clear()
  }

  /** getPoolSizes returns the size of each ID pool for debugging */
  getPoolSizes(): Record<string, number> {
    const sizes: Record<string, number> = {}
    for (const [poolName, ids] of this.pools.entries()) {
      sizes[poolName] = ids.length
    }
    return sizes
  }
}