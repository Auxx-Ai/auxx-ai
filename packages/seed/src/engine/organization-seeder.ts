// packages/seed/src/engine/organization-seeder.ts
// High-level orchestrator for organization-specific seeding with webhook management

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import type { SeedingContext, SeedingResult } from '../types'
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
    scenario:
      | 'demo'
      | 'development'
      | 'testing'
      | 'superadmin-test'
      | 'example'
      | 'shopify-review' = 'demo'
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

      // Skip webhook management for demo/test/example scenarios (mock integrations have no real webhooks)
      const shouldManageWebhooks =
        mode === 'reset' &&
        scenario !== 'demo' &&
        scenario !== 'superadmin-test' &&
        scenario !== 'example'

      if (mode === 'reset') {
        if (shouldManageWebhooks) {
          // Step 1: Disconnect webhooks
          logger.info('Step 1: Disconnecting webhooks')
          webhookState = await webhookCoordinator.disconnectAll()
          logger.info('Webhooks disconnected', { webhookState })
        }

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
      if (shouldManageWebhooks && webhookState) {
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
    scenario:
      | 'demo'
      | 'development'
      | 'testing'
      | 'superadmin-test'
      | 'example'
      | 'shopify-review' = 'demo'
  ): Promise<SeedingResult> {
    return OrganizationSeeder.seedOrganization(organizationId, 'reset', scenario)
  }

  /**
   * Convenience method for additive seeding (no reset).
   */
  static async addSeedData(
    organizationId: string,
    scenario:
      | 'demo'
      | 'development'
      | 'testing'
      | 'superadmin-test'
      | 'example'
      | 'shopify-review' = 'demo'
  ): Promise<SeedingResult> {
    return OrganizationSeeder.seedOrganization(organizationId, 'additive', scenario)
  }

  /**
   * Resets organization data by deleting in correct FK order.
   *
   * **`PermissionProfile` and `PermissionGrant` are deliberately EXCLUDED.** Adding
   * them here would be a silent footgun: `OrganizationMember.permissionProfileId`
   * (and `Agent`/`OrganizationInvitation`) is `onDelete: 'set null'`, so deleting
   * profiles would null every binding and drop the whole org to the `ROLE_DEFAULTS`
   * runtime fallback — with no FK error and no log to point at. Permissions are org
   * *configuration*, not seeded sample data. See
   * plans/permissions/v2/19-permission-profiles.md §1.1/§5.2.
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
      const { inArray } = await import('drizzle-orm')
      await db
        .delete(schema.MessageParticipant)
        .where(
          inArray(
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

      // 3. Entity data (FieldValues first, then EntityInstances - covers contacts, tickets, signatures)
      console.log('  ↳ Deleting field values...')
      await db.delete(schema.FieldValue).where(eq(schema.FieldValue.organizationId, organizationId))

      console.log('  ↳ Deleting entity instances...')
      await db
        .delete(schema.EntityInstance)
        .where(eq(schema.EntityInstance.organizationId, organizationId))

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
    scenarioName:
      | 'demo'
      | 'development'
      | 'testing'
      | 'superadmin-test'
      | 'example'
      | 'shopify-review'
  ): Promise<void> {
    try {
      logger.info('seedOrganizationDirectly: Starting', { organizationId, ownerId, scenarioName })

      logger.info('seedOrganizationDirectly: Imports loaded')

      const { demoScenario } = await import('../scenarios/demo.scenario')
      const { developmentScenario } = await import('../scenarios/development.scenario')
      const { testingScenario } = await import('../scenarios/testing.scenario')
      const { superadminTestScenario } = await import('../scenarios/superadmin-test.scenario')
      const { exampleScenario } = await import('../scenarios/example.scenario')
      const { shopifyReviewScenario } = await import('../scenarios/shopify-review.scenario')
      logger.info('seedOrganizationDirectly: Scenarios loaded')

      // Select scenario
      const scenarioMap = {
        demo: demoScenario,
        development: developmentScenario,
        testing: testingScenario,
        'superadmin-test': superadminTestScenario,
        example: exampleScenario,
        'shopify-review': shopifyReviewScenario,
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
      const context: SeedingContext = {
        auth: {
          testUsers: users.map((u) => ({ id: u.id, email: u.email || '' })),
          randomUsers: [],
          // Org-scoped reseeding never mints new logins, so there is nothing to report.
          credentials: { message: '', password: '', accounts: [] },
        },
        services: {
          organizations: [{ id: org.id, ownerId: org.ownerId }],
          integrations: integrations.map((i) => ({ id: i.id, organizationId: i.organizationId })),
          inboxes: inboxes.map((i) => ({ id: i.inboxId!, organizationId: i.organizationId })),
        },
      }
      logger.info('seedOrganizationDirectly: Context built', {
        testUsersCount: context.auth.testUsers.length,
        orgsCount: context.services.organizations.length,
        integrationsCount: context.services.integrations.length,
      })

      // For scenarios without a real integration, create a mock one before domain seeding.
      // demo/superadmin-test: full mock (Gmail + Shopify). example: Gmail only (no Shopify).
      if (
        scenarioName === 'demo' ||
        scenarioName === 'superadmin-test' ||
        scenarioName === 'example'
      ) {
        if (scenarioName === 'example') {
          logger.info('seedOrganizationDirectly: Creating example integration')
          const { ExampleIntegrationDomain } = await import('../domains/example-integration.domain')
          const exampleIntegrations = new ExampleIntegrationDomain(organizationId)
          await exampleIntegrations.insertDirectly(db)
          logger.info('seedOrganizationDirectly: Example integration created')
        } else {
          logger.info('seedOrganizationDirectly: Creating demo integrations')
          const { DemoIntegrationDomain } = await import('../domains/demo-integration.domain')
          const demoIntegrations = new DemoIntegrationDomain(organizationId, ownerId)
          await demoIntegrations.insertDirectly(db)
          logger.info('seedOrganizationDirectly: Demo integrations created')
        }

        // Re-fetch integrations after creating them
        const freshIntegrations = await db
          .select({
            id: schema.Integration.id,
            organizationId: schema.Integration.organizationId,
          })
          .from(schema.Integration)
          .where(eq(schema.Integration.organizationId, organizationId))

        const freshInboxes = await db
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

        // Update context with fresh integration data
        context.services.integrations = freshIntegrations.map((i) => ({
          id: i.id,
          organizationId: i.organizationId,
        }))
        context.services.inboxes = freshInboxes.map((i) => ({
          id: i.inboxId!,
          organizationId: i.organizationId,
        }))

        logger.info('seedOrganizationDirectly: Context refreshed with demo integrations', {
          integrations: context.services.integrations.length,
          inboxes: context.services.inboxes.length,
        })
      }

      // shopify-review guards — fail BEFORE any domain runs so an aborted seed
      // leaves nothing behind (no persona contacts without threads, no duplicates).
      if (scenarioName === 'shopify-review') {
        // No mock-integration fallback for this scenario (see above) — a threads-only
        // seed that silently seeds nothing is a failure, so fail loudly instead.
        if (context.services.integrations.length === 0 && scenario.scales.threads > 0) {
          throw new Error(
            `Cannot seed scenario "shopify-review" for organization ${organizationId}: ` +
              'the organization has no connected integrations. Connect an inbox first, then re-run the seed.'
          )
        }

        // Thread ids are freshly generated per run, so re-running would duplicate the
        // scripted threads/messages. Abort when the org already has them.
        const { and, inArray: inArrayOp } = await import('drizzle-orm')
        const { EXAMPLE_CONVERSATIONS } = await import('../generators/example-conversations')
        const scriptedSubjects = EXAMPLE_CONVERSATIONS.map((c) => c.subject)
        const alreadySeeded = await db
          .select({ id: schema.Thread.id })
          .from(schema.Thread)
          .where(
            and(
              eq(schema.Thread.organizationId, organizationId),
              inArrayOp(schema.Thread.subject, scriptedSubjects)
            )
          )
          .limit(1)
        if (alreadySeeded.length > 0) {
          throw new Error(
            `Organization ${organizationId} already contains shopify-review sample threads — ` +
              're-running would duplicate them. Delete the existing sample threads first if you need a fresh set.'
          )
        }
      }

      const domainOptions = { organizationId }

      // Seed domains directly
      logger.info('seedOrganizationDirectly: Loading domain classes')
      const { CrmDomain } = await import('../domains/crm.domain')
      const { OrganizationDomain } = await import('../domains/organization.domain')
      const { TicketDomain } = await import('../domains/ticket.domain')
      const { CommunicationDomain } = await import('../domains/communication.domain')
      const { AiDomain } = await import('../domains/ai.domain')
      logger.info('seedOrganizationDirectly: Domain classes loaded')

      // CRM
      logger.info('seedOrganizationDirectly: Seeding CRM domain')
      console.log('💾 Inserting CRM data...')
      const crm = new CrmDomain(scenario, context, domainOptions)
      await crm.insertDirectly(db)
      logger.info('seedOrganizationDirectly: CRM domain complete')

      // Organization (skipped for shopify-review — it's an additive injection into an
      // existing org and shouldn't touch that org's tags/snippets/settings rows)
      if (scenarioName !== 'shopify-review') {
        logger.info('seedOrganizationDirectly: Seeding organization domain')
        console.log('💾 Inserting organization data...')
        const organization = new OrganizationDomain(scenario, context, domainOptions)
        await organization.insertDirectly(db)
        logger.info('seedOrganizationDirectly: Organization domain complete')
      }

      // Tickets
      if (scenario.scales.tickets > 0) {
        logger.info('seedOrganizationDirectly: Seeding ticket domain')
        console.log('💾 Inserting ticket data...')
        const ticket = new TicketDomain(scenario, context, domainOptions)
        await ticket.insertDirectly(db)
        logger.info('seedOrganizationDirectly: Ticket domain complete')
      }

      // Communication (only if integrations exist — use refreshed context, not stale initial fetch)
      if (context.services.integrations.length > 0 && scenario.scales.threads > 0) {
        logger.info('seedOrganizationDirectly: Seeding communication domain')
        console.log('💾 Inserting communication data...')
        const communication = new CommunicationDomain(scenario, context, domainOptions)
        await communication.insertDirectly(db)
        logger.info('seedOrganizationDirectly: Communication domain complete')
      }

      // Workflows (example scenario instantiates one from a public template)
      if (scenario.scales.workflows && scenario.scales.workflows > 0) {
        logger.info('seedOrganizationDirectly: Seeding workflow domain')
        console.log('💾 Inserting workflow data...')
        const { WorkflowDomain } = await import('../domains/workflow.domain')
        const workflow = new WorkflowDomain(scenario, organizationId, ownerId)
        try {
          await workflow.insertDirectly(db)
          logger.info('seedOrganizationDirectly: Workflow domain complete')
        } catch (error) {
          // Non-fatal: example data is still useful without the workflow.
          logger.error('seedOrganizationDirectly: Workflow domain failed', { error })
        }
      }

      // AI
      if (scenario.features.aiAnalysis) {
        logger.info('seedOrganizationDirectly: Seeding AI domain')
        console.log('💾 Inserting AI usage data...')
        const ai = new AiDomain(scenario, context, domainOptions)
        await ai.insertDirectly(db)
        logger.info('seedOrganizationDirectly: AI domain complete')
      }

      // Datasets
      if (scenario.scales.datasets && scenario.scales.datasets > 0) {
        logger.info('seedOrganizationDirectly: Seeding dataset domain')
        console.log('💾 Inserting dataset data...')
        const { DatasetDomain } = await import('../domains/dataset.domain')
        const dataset = new DatasetDomain(organizationId, ownerId)
        await dataset.insertDirectly(db)
        logger.info('seedOrganizationDirectly: Dataset domain complete')
      }

      // Demo + superadmin-test polish (company is now a system entity, no
      // longer installed via the templates registry — created by the standard
      // org seeder)
      if (scenarioName === 'demo' || scenarioName === 'superadmin-test') {
        // Rename default inbox to match demo Gmail UX
        logger.info('seedOrganizationDirectly: Renaming inbox for demo')
        const { InboxService } = await import('@auxx/lib/inboxes')
        const inboxService = new InboxService(db, organizationId, ownerId)
        const inboxes = await inboxService.getInboxes()
        const defaultInbox = inboxes.find((i) => i.name === 'Shared Inbox')
        if (defaultInbox) {
          await inboxService.updateInboxById(defaultInbox.id, { name: 'Gmail Inbox' })
          logger.info('seedOrganizationDirectly: Inbox renamed to Gmail Inbox')
        }
      }

      // Invalidate caches so dehydration returns fresh data on first /app load
      logger.info('seedOrganizationDirectly: Invalidating caches')
      const { onCacheEvent } = await import('@auxx/lib/cache')
      await Promise.all([
        onCacheEvent('channel.connected', { orgId: organizationId }),
        onCacheEvent('org.updated', { orgId: organizationId }),
        onCacheEvent('inbox.created', { orgId: organizationId }),
        onCacheEvent('custom-field.created', { orgId: organizationId }),
        onCacheEvent('entity-def.created', { orgId: organizationId }),
      ])

      console.log('✅ Organization seeding complete')
      logger.info('seedOrganizationDirectly: Complete')
    } catch (error) {
      logger.error('seedOrganizationDirectly: Error occurred', { error })
      throw error
    }
  }
}
