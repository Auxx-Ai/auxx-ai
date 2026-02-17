// packages/seed/src/engine/organization-seeder.ts
// High-level orchestrator for organization-specific seeding with webhook management

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import type { SeedingResult } from '../types'
import { OrganizationWebhookCoordinator } from '../utils/organization-webhook-coordinator'

const logger = createScopedLogger('organization-seeder')

/**
 * OrganizationSeeder orchestrates organization-specific seeding operations.
 * Handles webhook lifecycle management and data reset/seeding.
 */
export class OrganizationSeeder {
  /**
   * Seed or reseed a specific organization with demo data.
   * @param organizationId - Target organization ID
   * @param mode - 'reset' (full reset + reseed) or 'additive' (add more data)
   * @param scenario - Scenario to use for seeding (defaults to 'demo')
   * @returns Seeding result with metrics
   */
  static async seedOrganization(
    organizationId: string,
    mode: 'reset' | 'additive',
    scenario: 'demo' | 'development' | 'testing' = 'demo'
  ): Promise<SeedingResult> {
    const webhookCoordinator = new OrganizationWebhookCoordinator(organizationId)
    let webhookState: Awaited<ReturnType<typeof webhookCoordinator.disconnectAll>> | null = null

    try {
      logger.info('Starting organization seeding', { organizationId, mode, scenario })

      // Verify organization exists
      logger.info('Fetching organization...')
      const [org] = await db
        .select({ id: schema.Organization.id, createdById: schema.Organization.createdById })
        .from(schema.Organization)
        .where(eq(schema.Organization.id, organizationId))
        .limit(1)

      if (!org) {
        throw new Error(`Organization ${organizationId} not found`)
      }
      logger.info('Organization found', { org })

      // Only disconnect webhooks if we're resetting
      if (mode === 'reset') {
        // Step 1: Disconnect webhooks
        logger.info('Step 1: Disconnecting webhooks')
        webhookState = await webhookCoordinator.disconnectAll()
        logger.info('Webhooks disconnected', { webhookState })

        // Step 2: Reset organization data
        logger.info('Step 2: Resetting organization data')
        await OrganizationSeeder.resetOrganizationData(organizationId)
        logger.info('Organization data reset complete')
      }

      // Step 3: Seed organization data
      logger.info(`Step ${mode === 'reset' ? '3' : '1'}: Seeding organization data`)
      await OrganizationSeeder.seedOrganizationDirectly(organizationId, org.createdById, scenario)
      logger.info('Organization seeding complete')

      // Step 4: Reconnect webhooks (only if we disconnected them)
      if (mode === 'reset' && webhookState) {
        logger.info('Step 4: Reconnecting webhooks')
        await webhookCoordinator.reconnectAll(webhookState)
        logger.info('Webhooks reconnected')
      }

      logger.info('Organization seeding completed successfully', {
        organizationId,
        mode,
      })

      return {
        domains: {},
        metrics: {
          duration: 0,
          entitiesCreated: 0,
          scenario,
        },
      }
    } catch (error) {
      logger.error('Organization seeding failed', {
        organizationId,
        mode,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })

      // Attempt to reconnect webhooks even on failure
      if (webhookState) {
        try {
          logger.info('Attempting to reconnect webhooks after failure')
          await webhookCoordinator.reconnectAll(webhookState)
          logger.info('Webhooks reconnected successfully after failure')
        } catch (reconnectError) {
          logger.error('Failed to reconnect webhooks after seeding failure', {
            reconnectError,
            organizationId,
          })
          // Don't throw here - original error is more important
        }
      }

      throw error
    }
  }

  /**
   * Convenience method for full reset and reseed.
   */
  static async resetAndSeed(
    organizationId: string,
    scenario: 'demo' | 'development' | 'testing' = 'demo'
  ): Promise<SeedingResult> {
    return OrganizationSeeder.seedOrganization(organizationId, 'reset', scenario)
  }

  /**
   * Convenience method for additive seeding (no reset).
   */
  static async addSeedData(
    organizationId: string,
    scenario: 'demo' | 'development' | 'testing' = 'demo'
  ): Promise<SeedingResult> {
    return OrganizationSeeder.seedOrganization(organizationId, 'additive', scenario)
  }

  /**
   * Resets organization data by deleting in correct FK order.
   */
  private static async resetOrganizationData(organizationId: string): Promise<void> {
    console.log(`🗑️  Resetting data for organization: ${organizationId}`)

    try {
      // Delete in reverse dependency order (children first, parents last)

      // 1. AI Usage (depends on everything)
      console.log('  ↳ Deleting AI usage data...')
      await db.delete(schema.AiUsage).where(eq(schema.AiUsage.organizationId, organizationId))

      // 2. Communication domain (Messages, Threads)
      console.log('  ↳ Deleting message participants...')
      await db
        .delete(schema.MessageParticipant)
        .where(
          eq(
            schema.MessageParticipant.messageId,
            db
              .select({ id: schema.Message.id })
              .from(schema.Message)
              .where(eq(schema.Message.organizationId, organizationId))
          )
        )

      console.log('  ↳ Deleting messages...')
      await db.delete(schema.Message).where(eq(schema.Message.organizationId, organizationId))

      console.log('  ↳ Deleting threads...')
      await db.delete(schema.Thread).where(eq(schema.Thread.organizationId, organizationId))

      // 3. Ticket replies (tickets are now EntityInstances)
      console.log('  ↳ Deleting ticket replies...')
      await db
        .delete(schema.TicketReply)
        .where(eq(schema.TicketReply.organizationId, organizationId))

      // 4. Entity data (FieldValues first, then EntityInstances - covers contacts, tickets, signatures)
      console.log('  ↳ Deleting field values...')
      await db.delete(schema.FieldValue).where(eq(schema.FieldValue.organizationId, organizationId))

      console.log('  ↳ Deleting entity instances...')
      await db
        .delete(schema.EntityInstance)
        .where(eq(schema.EntityInstance.organizationId, organizationId))

      // 5. Commerce domain (Orders → Addresses → Products/Customers)
      console.log('  ↳ Deleting orders...')
      await db.delete(schema.Order).where(eq(schema.Order.organizationId, organizationId))

      console.log('  ↳ Deleting addresses...')
      await db.delete(schema.Address).where(eq(schema.Address.organizationId, organizationId))

      console.log('  ↳ Deleting products...')
      await db.delete(schema.Product).where(eq(schema.Product.organizationId, organizationId))

      console.log('  ↳ Deleting customers...')
      await db
        .delete(schema.shopify_customers)
        .where(eq(schema.shopify_customers.organizationId, organizationId))

      // 6. CRM domain (Participants)
      console.log('  ↳ Deleting participants...')
      await db
        .delete(schema.Participant)
        .where(eq(schema.Participant.organizationId, organizationId))

      // 7. Organization domain entities
      console.log('  ↳ Deleting snippets...')
      await db.delete(schema.Snippet).where(eq(schema.Snippet.organizationId, organizationId))

      console.log('  ↳ Deleting tags...')
      await db.delete(schema.Tag).where(eq(schema.Tag.organizationId, organizationId))

      console.log(`✅ Organization data reset complete for: ${organizationId}`)
    } catch (error) {
      console.error(`❌ Failed to reset organization data for ${organizationId}:`, error)
      throw error
    }
  }

  /**
   * Seeds organization data directly without going through full seeder pipeline.
   * This bypasses ServiceIntegrator and uses existing organization/integration data.
   */
  private static async seedOrganizationDirectly(
    organizationId: string,
    ownerId: string,
    scenarioName: 'demo' | 'development' | 'testing'
  ): Promise<void> {
    try {
      logger.info('seedOrganizationDirectly: Starting', { organizationId, ownerId, scenarioName })

      logger.info('seedOrganizationDirectly: Imports loaded')

      const { demoScenario } = await import('../scenarios/demo.scenario')
      const { developmentScenario } = await import('../scenarios/development.scenario')
      const { testingScenario } = await import('../scenarios/testing.scenario')
      logger.info('seedOrganizationDirectly: Scenarios loaded')

      // Select scenario
      const scenarioMap = {
        demo: demoScenario,
        development: developmentScenario,
        testing: testingScenario,
      }
      const scenario = scenarioMap[scenarioName]
      logger.info('seedOrganizationDirectly: Scenario selected', { scenarioName })

      // Fetch existing organization data to build context
      logger.info('seedOrganizationDirectly: Fetching organization')
      const [org] = await db
        .select({
          id: schema.Organization.id,
          ownerId: schema.Organization.createdById,
        })
        .from(schema.Organization)
        .where(eq(schema.Organization.id, organizationId))
        .limit(1)

      if (!org) {
        throw new Error(`Organization ${organizationId} not found`)
      }
      logger.info('seedOrganizationDirectly: Organization fetched', { orgId: org.id })

      // Fetch integrations
      logger.info('seedOrganizationDirectly: Fetching integrations')
      const integrations = await db
        .select({ id: schema.Integration.id, organizationId: schema.Integration.organizationId })
        .from(schema.Integration)
        .where(eq(schema.Integration.organizationId, organizationId))
      logger.info('seedOrganizationDirectly: Integrations fetched', { count: integrations.length })

      // Fetch inboxes
      logger.info('seedOrganizationDirectly: Fetching inboxes')
      const inboxes = await db
        .select({
          inboxId: schema.InboxIntegration.inboxId,
          organizationId: schema.Organization.id,
        })
        .from(schema.InboxIntegration)
        .innerJoin(
          schema.Integration,
          eq(schema.InboxIntegration.integrationId, schema.Integration.id)
        )
        .innerJoin(
          schema.Organization,
          eq(schema.Integration.organizationId, schema.Organization.id)
        )
        .where(eq(schema.Organization.id, organizationId))
      logger.info('seedOrganizationDirectly: Inboxes fetched', { count: inboxes.length })

      // Fetch shopify integrations
      logger.info('seedOrganizationDirectly: Fetching shopify integrations')
      const shopifyIntegrations = await db
        .select({
          id: schema.ShopifyIntegration.id,
          organizationId: schema.ShopifyIntegration.organizationId,
          createdById: schema.ShopifyIntegration.createdById,
        })
        .from(schema.ShopifyIntegration)
        .where(eq(schema.ShopifyIntegration.organizationId, organizationId))
      logger.info('seedOrganizationDirectly: Shopify integrations fetched', {
        count: shopifyIntegrations.length,
      })

      // Fetch organization members/users
      logger.info('seedOrganizationDirectly: Fetching members')
      const members = await db
        .select({ userId: schema.OrganizationMember.userId })
        .from(schema.OrganizationMember)
        .where(eq(schema.OrganizationMember.organizationId, organizationId))

      logger.info('seedOrganizationDirectly: Members fetched', { count: members.length })

      const { inArray } = await import('drizzle-orm')
      const userIds = members.length > 0 ? members.map((m) => m.userId) : [ownerId]
      logger.info('seedOrganizationDirectly: User IDs prepared', { userIds })

      logger.info('seedOrganizationDirectly: Fetching users')
      const users = await db
        .select({ id: schema.User.id, email: schema.User.email })
        .from(schema.User)
        .where(inArray(schema.User.id, userIds))
      logger.info('seedOrganizationDirectly: Users fetched', { count: users.length })

      // Build seeding context
      logger.info('seedOrganizationDirectly: Building context')
      const context = {
        auth: {
          testUsers: users.map((u) => ({ id: u.id, email: u.email || '' })),
          randomUsers: [],
        },
        services: {
          organizations: [{ id: org.id, ownerId: org.ownerId }],
          integrations: integrations.map((i) => ({ id: i.id, organizationId: i.organizationId })),
          inboxes: inboxes.map((i) => ({ id: i.inboxId!, organizationId: i.organizationId })),
          shopifyIntegrations: shopifyIntegrations.map((i) => ({
            id: i.id,
            organizationId: i.organizationId,
            createdById: i.createdById,
          })),
        },
      }
      logger.info('seedOrganizationDirectly: Context built', {
        testUsersCount: context.auth.testUsers.length,
        orgsCount: context.services.organizations.length,
        integrationsCount: context.services.integrations.length,
      })

      const domainOptions = { organizationId }

      // Seed domains directly
      logger.info('seedOrganizationDirectly: Loading domain classes')
      const { CrmDomain } = await import('../domains/crm.domain')
      const { OrganizationDomain } = await import('../domains/organization.domain')
      const { CommerceDomain } = await import('../domains/commerce.domain')
      const { TicketDomain } = await import('../domains/ticket.domain')
      const { CommunicationDomain } = await import('../domains/communication.domain')
      const { AiDomain } = await import('../domains/ai.domain')
      logger.info('seedOrganizationDirectly: Domain classes loaded')

      // Cast scenario to SeedingScenario with empty buildRefinements
      const scenarioWithRefinements = {
        ...scenario,
        buildRefinements: () => ({}),
      }

      // CRM
      logger.info('seedOrganizationDirectly: Seeding CRM domain')
      console.log('💾 Inserting CRM data...')
      const crm = new CrmDomain(scenarioWithRefinements, context, domainOptions)
      await crm.insertDirectly(db)
      logger.info('seedOrganizationDirectly: CRM domain complete')

      // Organization
      logger.info('seedOrganizationDirectly: Seeding organization domain')
      console.log('💾 Inserting organization data...')
      const organization = new OrganizationDomain(scenarioWithRefinements, context, domainOptions)
      await organization.insertDirectly(db)
      logger.info('seedOrganizationDirectly: Organization domain complete')

      // Commerce (only if shopify integration exists)
      if (shopifyIntegrations.length > 0) {
        logger.info('seedOrganizationDirectly: Seeding commerce domain')
        console.log('💾 Inserting commerce data...')
        const commerce = new CommerceDomain(scenarioWithRefinements, context, domainOptions)
        await commerce.insertDirectly(db)
        logger.info('seedOrganizationDirectly: Commerce domain complete')
      }

      // Tickets
      if (scenario.scales.tickets > 0) {
        logger.info('seedOrganizationDirectly: Seeding ticket domain')
        console.log('💾 Inserting ticket data...')
        const ticket = new TicketDomain(scenarioWithRefinements, context, domainOptions)
        await ticket.insertDirectly(db)
        logger.info('seedOrganizationDirectly: Ticket domain complete')
      }

      // Communication (only if integrations exist)
      if (integrations.length > 0 && scenario.scales.threads > 0) {
        logger.info('seedOrganizationDirectly: Seeding communication domain')
        console.log('💾 Inserting communication data...')
        const communication = new CommunicationDomain(
          scenarioWithRefinements,
          context,
          domainOptions
        )
        await communication.insertDirectly(db)
        logger.info('seedOrganizationDirectly: Communication domain complete')
      }

      // AI
      if (scenario.features.aiAnalysis) {
        logger.info('seedOrganizationDirectly: Seeding AI domain')
        console.log('💾 Inserting AI usage data...')
        const ai = new AiDomain(scenarioWithRefinements, context, domainOptions)
        await ai.insertDirectly(db)
        logger.info('seedOrganizationDirectly: AI domain complete')
      }

      console.log('✅ Organization seeding complete')
      logger.info('seedOrganizationDirectly: Complete')
    } catch (error) {
      logger.error('seedOrganizationDirectly: Error occurred', { error })
      throw error
    }
  }
}
