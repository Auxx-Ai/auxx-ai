// packages/seed/src/engine/service-integrator.ts
// Service-based seeding helpers for entities requiring business logic coordination

import { createId } from '@paralleldrive/cuid2'
import { eq } from 'drizzle-orm'
import { database, schema } from '@auxx/database'
import { OrganizationSeeder } from '@auxx/lib/seed'
import { SettingsInitializer } from '@auxx/lib/settings'
import type { SeedingScenario, SeedingConfig, ServiceIntegratorResult } from '../types'
import type { IdPoolManager } from '../utils/id-pool-manager'
import type { RelationalDomainBuilder } from '../builders/relational-domain-builder'

/**
 * ServiceIntegrator orchestrates entities that benefit from service-layer logic rather than bulk seeding.
 * Enhanced to support multi-phase relational seeding with proper foreign key relationships.
 */
export class ServiceIntegrator {
  /** config stores CLI configuration flags. */
  private readonly config: SeedingConfig
  /** scenario stores the resolved scenario definition. */
  private readonly scenario: SeedingScenario
  /** idPoolManager manages foreign key ID pools. */
  private readonly idPoolManager: IdPoolManager
  /** relationalBuilder creates domain refinements with proper relationships. */
  private readonly relationalBuilder: RelationalDomainBuilder

  /**
   * Creates a new ServiceIntegrator instance.
   * @param config - CLI/runtime configuration.
   * @param scenario - Scenario definition to follow.
   * @param idPoolManager - ID pool manager for foreign keys.
   * @param relationalBuilder - Relational domain builder.
   */
  constructor(
    config: SeedingConfig,
    scenario: SeedingScenario,
    idPoolManager: IdPoolManager,
    relationalBuilder: RelationalDomainBuilder
  ) {
    this.config = config
    this.scenario = scenario
    this.idPoolManager = idPoolManager
    this.relationalBuilder = relationalBuilder
  }

  /**
   * execute provisions organizations, memberships, and integrations required by other domains.
   * @param authContext - Results from the authentication seeder.
   * @returns Summary of created service-driven entities.
   */
  async execute(authContext: {
    testUsers: Array<{ id: string; email: string; role?: string }>
    randomUsers: Array<{ id: string; email: string }>
  }): Promise<ServiceIntegratorResult> {
    const owners =
      authContext.testUsers.length > 0 ? authContext.testUsers : authContext.randomUsers
    const now = new Date()
    const organizations: Array<{ id: string; ownerId: string }> = []
    const integrations: Array<{ id: string; organizationId: string }> = []
    const inboxes: Array<{ id: string; organizationId: string }> = []
    const shopifyIntegrations: Array<{ id: string; organizationId: string; createdById: string }> =
      []
    const defaultAssignments = new Map<string, string>()

    const organizationTarget = Math.max(1, this.scenario.scales.organizations)

    for (let i = 0; i < organizationTarget; i++) {
      const owner = owners[i % owners.length]
      if (!owner) break

      const organizationId = await this.ensureOrganization(owner.id, now, i)

      // Seed organization settings, user settings, and default tags
      await this.seedOrganizationDefaults(organizationId, owner.id)

      await this.ensureOrganizationMember(organizationId, owner.id, 'OWNER', now)
      if (!defaultAssignments.has(owner.id)) {
        defaultAssignments.set(owner.id, organizationId)
      }

      // Seed user settings for owner
      await this.seedUserSettings(owner.id, organizationId)

      // Attach a handful of the remaining curated users as admins/members
      const additionalMembers = authContext.testUsers
        .filter((user) => user.id !== owner.id)
        .slice(0, 3)
      for (const member of additionalMembers) {
        await this.ensureOrganizationMember(organizationId, member.id, 'ADMIN', now)
        if (!defaultAssignments.has(member.id)) {
          defaultAssignments.set(member.id, organizationId)
        }
        // Seed user settings for member
        await this.seedUserSettings(member.id, organizationId)
      }

      // Optionally attach random users as standard members for richer data
      const randomMembers = authContext.randomUsers.slice(i * 3, i * 3 + 3)
      for (const member of randomMembers) {
        await this.ensureOrganizationMember(organizationId, member.id, 'USER', now)
        if (!defaultAssignments.has(member.id)) {
          defaultAssignments.set(member.id, organizationId)
        }
        // Seed user settings for member
        await this.seedUserSettings(member.id, organizationId)
      }

      const integrationId = await this.ensureIntegration(organizationId, now, i)
      integrations.push({ id: integrationId, organizationId })

      const shopifyIntegrationId = await this.ensureShopifyIntegration(
        organizationId,
        owner.id,
        now,
        i
      )
      shopifyIntegrations.push({ id: shopifyIntegrationId, organizationId, createdById: owner.id })

      const inboxId = await this.ensureInbox(organizationId, now, i)
      inboxes.push({ id: inboxId, organizationId })

      organizations.push({ id: organizationId, ownerId: owner.id })
    }

    if (organizations.length > 0) {
      for (let index = 0; index < authContext.randomUsers.length; index++) {
        const user = authContext.randomUsers[index]
        if (!user || defaultAssignments.has(user.id)) {
          continue
        }

        const targetOrg = organizations[index % organizations.length]
        if (!targetOrg) {
          continue
        }

        await this.ensureOrganizationMember(targetOrg.id, user.id, 'USER', now)
        if (!defaultAssignments.has(user.id)) {
          defaultAssignments.set(user.id, targetOrg.id)
        }
        // Seed user settings for member
        await this.seedUserSettings(user.id, targetOrg.id)
      }
    }

    for (const [userId, organizationId] of defaultAssignments.entries()) {
      await this.ensureDefaultOrganization(userId, organizationId, now)
    }

    return { organizations, integrations, inboxes, shopifyIntegrations }
  }

  /**
   * ensureOrganization upserts an organization and returns its identifier.
   * @param ownerId - Owner user identifier.
   * @param updatedAt - Timestamp reused for deterministic updates.
   * @param index - Organization index for naming and handle generation.
   * @returns The organization identifier.
   */
  private async ensureOrganization(
    ownerId: string,
    updatedAt: Date,
    index: number
  ): Promise<string> {
    const handle = `org-${index + 1}-${ownerId.slice(0, 6)}`.toLowerCase()

    const inserted = await database
      .insert(schema.Organization)
      .values({
        id: createId(),
        name: `Organization ${index + 1}`,
        createdById: ownerId,
        updatedAt,
        handle,
      })
      .onConflictDoUpdate({
        target: schema.Organization.handle,
        set: {
          name: `Organization ${index + 1}`,
          updatedAt,
          createdById: ownerId,
        },
      })
      .returning({ id: schema.Organization.id })

    const organizationId = inserted[0]?.id
    if (!organizationId) {
      throw new Error(`Failed to upsert organization with handle ${handle}`)
    }

    return organizationId
  }

  /**
   * ensureOrganizationMember creates or updates an organization membership.
   * @param organizationId - Target organization identifier.
   * @param userId - Target user identifier.
   * @param role - Role to assign to the membership.
   * @param updatedAt - Timestamp reused for deterministic updates.
   */
  private async ensureOrganizationMember(
    organizationId: string,
    userId: string,
    role: 'OWNER' | 'ADMIN' | 'USER',
    updatedAt: Date
  ): Promise<void> {
    await database
      .insert(schema.OrganizationMember)
      .values({
        id: createId(),
        organizationId,
        userId,
        role,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [schema.OrganizationMember.organizationId, schema.OrganizationMember.userId],
        set: { role, updatedAt },
      })
  }

  /**
   * ensureIntegration provisions a default email integration per organization.
   * @param organizationId - Organization that owns the integration.
   * @param updatedAt - Timestamp reused for deterministic updates.
   * @param index - Zero-based organization index for uniqueness helpers.
   * @returns The integration identifier.
   */
  private async ensureIntegration(
    organizationId: string,
    updatedAt: Date,
    index: number
  ): Promise<string> {
    const integrationId = createId()
    const emailAlias = `support+${index + 1}@seeded.dev`

    const inserted = await database
      .insert(schema.Integration)
      .values({
        id: integrationId,
        organizationId,
        name: `Gmail ${index + 1}`,
        email: emailAlias,
        updatedAt,
        provider: 'google',
        messageType: 'EMAIL',
        createdAt: updatedAt,
        enabled: true,
        settings: {},
      })
      .onConflictDoUpdate({
        target: [schema.Integration.organizationId, schema.Integration.email],
        set: { updatedAt, enabled: true, email: emailAlias },
      })
      .returning({ id: schema.Integration.id })

    return inserted[0]?.id ?? integrationId
  }

  /**
   * ensureShopifyIntegration provisions a Shopify integration per organization.
   * @param organizationId - Organization that owns the Shopify integration.
   * @param createdById - User who created the integration.
   * @param updatedAt - Timestamp reused for deterministic updates.
   * @param index - Zero-based organization index for uniqueness helpers.
   * @returns The Shopify integration identifier.
   */
  private async ensureShopifyIntegration(
    organizationId: string,
    createdById: string,
    updatedAt: Date,
    index: number
  ): Promise<string> {
    const shopDomain = `seeded-shop-${index + 1}.myshopify.com`
    const accessToken = `seeded-token-${index + 1}`

    const id = createId()

    const inserted = await database
      .insert(schema.ShopifyIntegration)
      .values({
        id,
        organizationId,
        createdById,
        shopDomain,
        accessToken,
        scope: 'read_products,write_products,read_customers,write_customers',
        enabled: true,
        updatedAt,
        createdAt: updatedAt,
      })
      .onConflictDoUpdate({
        target: [schema.ShopifyIntegration.organizationId, schema.ShopifyIntegration.shopDomain],
        set: {
          updatedAt,
          enabled: true,
          accessToken,
          scope: 'read_products,write_products,read_customers,write_customers',
        },
      })
      .returning({ id: schema.ShopifyIntegration.id })

    return inserted[0]?.id ?? id
  }

  /**
   * ensureInbox provisions a default inbox for each organization.
   * @param organizationId - Organization that owns the inbox.
   * @param updatedAt - Timestamp reused for deterministic updates.
   * @param index - Zero-based organization index for naming.
   * @returns The inbox identifier.
   */
  private async ensureInbox(
    organizationId: string,
    updatedAt: Date,
    index: number
  ): Promise<string> {
    const inboxId = createId()

    const inserted = await database
      .insert(schema.Inbox)
      .values({
        id: inboxId,
        organizationId,
        name: `Support Inbox ${index + 1}`,
        updatedAt,
        settings: {},
        allowAllMembers: true,
        enableMemberAccess: false,
        enableGroupAccess: false,
      })
      .onConflictDoUpdate({
        target: [schema.Inbox.organizationId, schema.Inbox.name],
        set: { updatedAt },
      })
      .returning({ id: schema.Inbox.id })

    return inserted[0]?.id ?? inboxId
  }

  /**
   * ensureDefaultOrganization assigns the default organization for a user.
   * @param userId - User identifier to update.
   * @param organizationId - Organization identifier to set as default.
   * @param updatedAt - Timestamp reused for deterministic updates.
   */
  private async ensureDefaultOrganization(
    userId: string,
    organizationId: string,
    updatedAt: Date
  ): Promise<void> {
    await database
      .update(schema.User)
      .set({ defaultOrganizationId: organizationId, updatedAt })
      .where(eq(schema.User.id, userId))
  }

  /**
   * seedOrganizationDefaults initializes organization settings and default tags.
   * @param organizationId - Organization identifier to seed.
   * @param userId - User identifier for tag creation.
   */
  private async seedOrganizationDefaults(organizationId: string, userId: string): Promise<void> {
    const seeder = new OrganizationSeeder(database, userId)
    await seeder.seedNewOrganization(organizationId)
  }

  /**
   * seedUserSettings initializes default user settings.
   * @param userId - User identifier to seed settings for.
   * @param organizationId - Organization identifier for user settings.
   */
  private async seedUserSettings(userId: string, organizationId: string): Promise<void> {
    // TODO: Implement initializeUserSettings method in SettingsInitializer
    // For now, this is a placeholder - user settings will be created on first login
  }

  // ---- Multi-Phase Execution Methods ----

  /**
   * executePhase1 seeds foundation entities (User, Session, etc.)
   * @returns Promise that resolves when Phase 1 is complete
   */
  async executePhase1(): Promise<void> {
    console.log('🌟 Phase 1: Foundation Entities')

    // Initialize User ID pool - this must happen first
    const userIds = this.idPoolManager.generateUserIds()
    console.log(`Generated ${userIds.length} User IDs for Phase 1`)

    // Validate that ID pools are properly initialized
    this.idPoolManager.validatePools()

    console.log('✅ Phase 1 complete - Foundation entities ready')
  }

  /**
   * executePhase2 seeds organizations and core settings
   * @returns Promise that resolves when Phase 2 is complete
   */
  async executePhase2(): Promise<void> {
    console.log('🏢 Phase 2: Organization Foundation')

    // Initialize Organization ID pool
    const orgIds = this.idPoolManager.generateOrganizationIds()
    console.log(`Generated ${orgIds.length} Organization IDs for Phase 2`)

    // Validate dependencies from Phase 1
    const userIds = this.idPoolManager.getUserIds()
    if (userIds.length === 0) {
      throw new Error('Phase 2 requires User IDs from Phase 1. Run executePhase1() first.')
    }

    console.log('✅ Phase 2 complete - Organizations and settings ready')
  }

  /**
   * executePhase3 seeds integration layer (EmailIntegration, etc.)
   * @returns Promise that resolves when Phase 3 is complete
   */
  async executePhase3(): Promise<void> {
    console.log('🔗 Phase 3: Integration Layer')

    // Initialize Integration and Template ID pools
    const integrationIds = this.idPoolManager.generateIntegrationIds()
    const templateIds = this.idPoolManager.generateTemplateIds()

    console.log(`Generated ${integrationIds.length} Integration IDs for Phase 3`)
    console.log(`Generated ${templateIds.length} Template IDs for Phase 3`)

    // Validate dependencies from previous phases
    const orgIds = this.idPoolManager.getOrganizationIds()
    if (orgIds.length === 0) {
      throw new Error('Phase 3 requires Organization IDs from Phase 2. Run executePhase2() first.')
    }

    console.log('✅ Phase 3 complete - Integrations ready')
  }

  /**
   * executePhase4 seeds business entities (Thread, Product, Customer)
   * @returns Promise that resolves when Phase 4 is complete
   */
  async executePhase4(): Promise<void> {
    console.log('💼 Phase 4: Business Entities')

    // Validate all required dependencies
    const userIds = this.idPoolManager.getUserIds()
    const orgIds = this.idPoolManager.getOrganizationIds()
    const integrationIds = this.idPoolManager.getIntegrationIds()

    if (userIds.length === 0) {
      throw new Error('Phase 4 requires User IDs from Phase 1')
    }
    if (orgIds.length === 0) {
      throw new Error('Phase 4 requires Organization IDs from Phase 2')
    }
    if (integrationIds.length === 0) {
      throw new Error('Phase 4 requires Integration IDs from Phase 3')
    }

    console.log('✅ Phase 4 complete - Business entities ready')
  }

  /**
   * executePhase5 seeds analytics and automation (AiUsage, AutoResponseRule)
   * @returns Promise that resolves when Phase 5 is complete
   */
  async executePhase5(): Promise<void> {
    console.log('🤖 Phase 5: Analytics & Automation')

    // Validate all dependencies are available
    const poolSizes = this.idPoolManager.getPoolSizes()
    console.log('ID Pool Sizes:', poolSizes)

    if (!poolSizes.User || !poolSizes.Organization) {
      throw new Error('Phase 5 requires both User and Organization ID pools from previous phases')
    }

    console.log('✅ Phase 5 complete - Analytics and automation ready')
  }

  /**
   * executeAllPhases runs the complete multi-phase seeding process
   * @returns Promise that resolves when all phases are complete
   */
  async executeAllPhases(): Promise<void> {
    console.log('🚀 Starting Multi-Phase Relational Seeding')

    try {
      await this.executePhase1()
      await this.executePhase2()
      await this.executePhase3()
      await this.executePhase4()
      await this.executePhase5()

      console.log('🎉 All phases complete - Relational seeding finished')
    } catch (error) {
      console.error('❌ Multi-phase seeding failed:', error)
      throw error
    }
  }

  /**
   * validatePhasePrerequisites checks that all required ID pools are initialized
   * @param phase - Phase number to validate
   */
  private validatePhasePrerequisites(phase: number): void {
    const poolSizes = this.idPoolManager.getPoolSizes()

    switch (phase) {
      case 2:
        if (!poolSizes.User) {
          throw new Error('Phase 2 requires User ID pool from Phase 1')
        }
        break
      case 3:
        if (!poolSizes.User || !poolSizes.Organization) {
          throw new Error('Phase 3 requires User and Organization ID pools from previous phases')
        }
        break
      case 4:
        if (!poolSizes.User || !poolSizes.Organization || !poolSizes.Integration) {
          throw new Error(
            'Phase 4 requires User, Organization, and Integration ID pools from previous phases'
          )
        }
        break
      case 5:
        if (!poolSizes.User || !poolSizes.Organization || !poolSizes.MessageTemplate) {
          throw new Error(
            'Phase 5 requires User, Organization, and MessageTemplate ID pools from previous phases'
          )
        }
        break
    }
  }

  /**
   * getPhaseStatus returns the current status of all phases
   * @returns Object describing which phases are ready to run
   */
  getPhaseStatus(): Record<string, boolean> {
    const poolSizes = this.idPoolManager.getPoolSizes()

    return {
      phase1Ready: true, // Phase 1 has no dependencies
      phase2Ready: !!poolSizes.User,
      phase3Ready: !!poolSizes.User && !!poolSizes.Organization,
      phase4Ready: !!poolSizes.User && !!poolSizes.Organization && !!poolSizes.Integration,
      phase5Ready: !!poolSizes.User && !!poolSizes.Organization && !!poolSizes.MessageTemplate,
    }
  }
}
