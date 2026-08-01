// packages/seed/src/engine/service-integrator.ts
// Service-based seeding helpers for entities requiring business logic coordination

import { database, schema } from '@auxx/database'
import { InboxService } from '@auxx/lib/inboxes'
import { ensureSystemProfiles } from '@auxx/lib/permissions'
import { OrganizationSeeder } from '@auxx/lib/seed'
import { createId } from '@paralleldrive/cuid2'
import { eq, isNull } from 'drizzle-orm'
import type { SeedingConfig, SeedingScenario, ServiceIntegratorResult } from '../types'

/**
 * ServiceIntegrator orchestrates entities that benefit from service-layer logic rather than bulk seeding.
 */
export class ServiceIntegrator {
  /** config stores CLI configuration flags. */
  private readonly config: SeedingConfig
  /** scenario stores the resolved scenario definition. */
  private readonly scenario: SeedingScenario

  /**
   * Creates a new ServiceIntegrator instance.
   * @param config - CLI/runtime configuration.
   * @param scenario - Scenario definition to follow.
   */
  constructor(config: SeedingConfig, scenario: SeedingScenario) {
    this.config = config
    this.scenario = scenario
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

      // Attach a handful of the remaining curated users as admins/members
      const additionalMembers = authContext.testUsers
        .filter((user) => user.id !== owner.id)
        .slice(0, 3)
      for (const member of additionalMembers) {
        await this.ensureOrganizationMember(organizationId, member.id, 'ADMIN', now)
        if (!defaultAssignments.has(member.id)) {
          defaultAssignments.set(member.id, organizationId)
        }
      }

      // Optionally attach random users as standard members for richer data
      const randomMembers = authContext.randomUsers.slice(i * 3, i * 3 + 3)
      for (const member of randomMembers) {
        await this.ensureOrganizationMember(organizationId, member.id, 'USER', now)
        if (!defaultAssignments.has(member.id)) {
          defaultAssignments.set(member.id, organizationId)
        }
      }

      const integrationId = await this.ensureIntegration(organizationId, now, i)
      integrations.push({ id: integrationId, organizationId })

      const inboxId = await this.ensureInbox(organizationId, owner.id)
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
      }
    }

    for (const [userId, organizationId] of defaultAssignments.entries()) {
      await this.ensureDefaultOrganization(userId, organizationId, now)
    }

    return { organizations, integrations, inboxes }
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

    // Seed the system permission profiles here (not only via the downstream
    // OrganizationSeeder) so a dev/demo org exercises the real null-binding
    // resolution path instead of permanently riding the ROLE_DEFAULTS runtime
    // fallback. Idempotent. See plans/permissions/v2/19-permission-profiles.md §5.2.
    await ensureSystemProfiles(organizationId, database)

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
        createdAt: updatedAt,
        enabled: true,
      })
      // Matches the partial unique index on Integration:
      // (organizationId, provider, email) WHERE "deletedAt" IS NULL.
      .onConflictDoUpdate({
        target: [
          schema.Integration.organizationId,
          schema.Integration.provider,
          schema.Integration.email,
        ],
        targetWhere: isNull(schema.Integration.deletedAt),
        set: { updatedAt, enabled: true },
      })
      .returning({ id: schema.Integration.id })

    return inserted[0]?.id ?? integrationId
  }

  /**
   * ensureInbox resolves the organization's shared inbox.
   *
   * Inboxes are EntityInstances, not a standalone table — `seedOrganizationDefaults`
   * (which runs first) already creates the shared inbox via `OrganizationSeeder`, so
   * this only has to find it and fall back to creating it when absent.
   * @param organizationId - Organization that owns the inbox.
   * @param ownerId - User acting as the creator for lazily created inboxes.
   * @returns The inbox EntityInstance identifier.
   */
  private async ensureInbox(organizationId: string, ownerId: string): Promise<string> {
    const inboxService = new InboxService(database, organizationId, ownerId)
    const inbox = await inboxService.getOrCreateSharedInbox()
    return inbox.id
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
}
