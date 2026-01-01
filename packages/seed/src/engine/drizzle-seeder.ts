// packages/seed/src/engine/drizzle-seeder.ts
// Core orchestrator that coordinates reset, service integrations, auth seeding, and drizzle-seed generation

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { seed, reset } from 'drizzle-seed'
import { env } from '@auxx/config'
import { schema } from '@auxx/database'
import type { SeedingConfig, SeedingContext, SeedingResult, SeedingScenario } from '../types'
import { ScenarioBuilder } from '../scenarios/scenario-builder'
import { AuthSeeder } from './auth-seeder'
import { ServiceIntegrator } from './service-integrator'
import { ProgressTracker } from '../utils/progress-tracker'

/** DrizzleSeeder coordinates the multi-phase database seeding workflow. */
export class DrizzleSeeder {
  /** config stores CLI/runtime configuration flags. */
  private readonly config: SeedingConfig
  /** scenario stores the resolved scenario definition. */
  private readonly scenario: SeedingScenario
  /** tracker manages CLI progress output. */
  private readonly tracker: ProgressTracker
  /** authSeeder provisions authentication entities. */
  private readonly authSeeder: AuthSeeder
  /** serviceIntegrator provisions complex service-driven entities. */
  private readonly serviceIntegrator: ServiceIntegrator
  /** client is the underlying postgres-js client. */
  private readonly client: ReturnType<typeof postgres>
  /** db is the drizzle connection used by drizzle-seed. */
  private readonly db: ReturnType<typeof drizzle>

  /**
   * Creates a new DrizzleSeeder instance.
   * @param config - CLI/runtime configuration for the seeder.
   */
  constructor(config: SeedingConfig) {
    this.config = config
    this.scenario = ScenarioBuilder.build(config.scenario, config.overrides)
    this.tracker = new ProgressTracker(config.progress)
    this.authSeeder = new AuthSeeder(config)
    this.serviceIntegrator = new ServiceIntegrator(config, this.scenario)

    const connectionString = env.DATABASE_URL ?? process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL is required to run the seeder')
    }

    this.client = postgres(connectionString, { max: 1 })
    this.db = drizzle(this.client, { schema })
  }

  /**
   * execute runs the full seeding workflow and returns aggregated results.
   * @returns Aggregated seeding result metadata.
   */
  async execute(): Promise<SeedingResult> {
    const startedAt = Date.now()
    const result: SeedingResult = {
      domains: {},
      metrics: {
        duration: 0,
        entitiesCreated: 0,
        scenario: this.config.scenario,
      },
    }

    try {
      if (this.config.reset) {
        if (this.config.organizationId) {
          this.tracker.start('Resetting organization data')
          await this.resetOrganizationData(this.config.organizationId)
          this.tracker.succeed('Organization data reset complete')
        } else {
          this.tracker.start('Resetting database')
          await this.resetDatabase()
          this.tracker.succeed('Database reset complete')
        }
      }

      if (this.isBillingPlansOnly()) {
        this.tracker.start('Seeding billing plans (plans-only mode)')
        const plansCreated = await this.seedBillingPlansOnly(result)
        this.tracker.succeed('Billing plans seeded')

        result.metrics.duration = Date.now() - startedAt
        result.metrics.entitiesCreated = plansCreated
        return result
      }

      this.tracker.start('Seeding authentication records')
      const authResult = await this.authSeeder.execute()
      this.tracker.succeed('Authentication seeding complete')
      result.domains.auth = authResult

      this.tracker.start('Seeding organization structures')
      const serviceResult = await this.serviceIntegrator.execute(authResult)
      this.tracker.succeed('Organization seeding complete')
      result.domains.services = serviceResult

      this.tracker.start('Running drizzle-seed refinements')
      const seedingContext: SeedingContext = { auth: authResult, services: serviceResult }

      const bulkResult = await this.executeDirectInserts(seedingContext)
      this.tracker.succeed('Direct inserts complete')
      result.domains.bulk = bulkResult

      if (this.config.validate) {
        this.tracker.start('Validating seeded data')
        await this.validateSeeding()
        this.tracker.succeed('Validation complete')
      }

      result.metrics.duration = Date.now() - startedAt
      result.metrics.entitiesCreated = this.calculateTotalEntities(result)
      return result
    } catch (error) {
      this.tracker.fail('Seeding failed')
      throw error
    } finally {
      await this.client.end({ timeout: 5 })
    }
  }

  /**
   * executeDirectInserts performs direct database inserts bypassing drizzle-seed.
   * @param context - Context from earlier seeding phases.
   * @returns Result metadata.
   */
  private async executeDirectInserts(context: SeedingContext): Promise<unknown> {
    const { BillingDomain } = await import('../domains/billing.domain')
    const { CommerceDomain } = await import('../domains/commerce.domain')
    const { CommunicationDomain } = await import('../domains/communication.domain')
    const { AiDomain } = await import('../domains/ai.domain')
    const { CrmDomain } = await import('../domains/crm.domain')
    const { OrganizationDomain } = await import('../domains/organization.domain')
    const { TicketDomain } = await import('../domains/ticket.domain')

    let billingPlansCreated = 0

    const domainOptions = {
      organizationId: this.config.organizationId,
    }

    try {
      // Skip billing if organization-specific OR preserveBilling flag
      if (!this.config.organizationId && !this.config.preserveBilling) {
        console.log('💳 Inserting billing data directly...')
        const billing = new BillingDomain(this.scenario, context)
        billingPlansCreated = await billing.insertDirectly(this.db)
        console.log('✅ Billing data inserted')
      } else {
        console.log('⏭️  Skipping billing domain (preserving existing subscriptions)')
      }

      // CRM inserts (Contacts & Participants) - Must come first as other domains depend on them
      console.log('💾 Inserting CRM data directly...')
      const crm = new CrmDomain(this.scenario, context, domainOptions)
      await crm.insertDirectly(this.db)
      console.log('✅ CRM data inserted')

      // Organization inserts (Tags, Signatures, Snippets)
      console.log('💾 Inserting organization data directly...')
      const organization = new OrganizationDomain(this.scenario, context, domainOptions)
      await organization.insertDirectly(this.db)
      console.log('✅ Organization data inserted')

      // Commerce inserts
      if (this.scenario.scales.products > 0 || this.scenario.scales.customers > 0) {
        console.log('💾 Inserting commerce data directly...')
        const commerce = new CommerceDomain(this.scenario, context, domainOptions)
        await commerce.insertDirectly(this.db)
        console.log('✅ Commerce data inserted')
      }

      // Ticket inserts (Tickets, Replies, Notes, Assignments, Relations)
      if (this.scenario.scales.tickets > 0) {
        console.log('💾 Inserting ticket data directly...')
        const ticket = new TicketDomain(this.scenario, context, domainOptions)
        await ticket.insertDirectly(this.db)
        console.log('✅ Ticket data inserted')
      }

      // Communication inserts (Threads, Messages, TagOnThread, MessageParticipant)
      if (this.scenario.scales.threads > 0) {
        console.log('💾 Inserting communication data directly...')
        const communication = new CommunicationDomain(this.scenario, context, domainOptions)
        await communication.insertDirectly(this.db)
        console.log('✅ Communication data inserted')
      }

      // AI inserts
      if (this.scenario.features.aiAnalysis) {
        console.log('💾 Inserting AI usage data directly...')
        const ai = new AiDomain(this.scenario, context, domainOptions)
        await ai.insertDirectly(this.db)
        console.log('✅ AI data inserted')
      }

      return { method: 'direct-insert', success: true, billingPlansCreated }
    } catch (error) {
      console.error('❌ Direct insert failed', {
        scenario: this.config.scenario,
        message: (error as Error).message,
      })
      console.error(error)
      throw error
    }
  }

  /**
   * seedBillingPlansOnly executes the minimal billing plans seeding workflow.
   * Creates both database plans and Stripe resources.
   * @param result - Aggregated seeding result container to populate.
   * @returns Number of plans created during the billing-only run.
   */
  private async seedBillingPlansOnly(result: SeedingResult): Promise<number> {
    const { BillingDomain } = await import('../domains/billing.domain')

    const billing = new BillingDomain(this.scenario, this.createEmptyContext(), {
      plansOnly: false, // Always create Stripe resources with --billing-plans-only
    })

    const plansCreated = await billing.insertDirectly(this.db)
    result.domains.billing = {
      mode: 'billing-with-stripe',
      plansCreated,
    }

    return plansCreated
  }

  /**
   * createEmptyContext builds a blank seeding context used for billing-only runs.
   * @returns Empty seeding context with placeholder auth/service data.
   */
  private createEmptyContext(): SeedingContext {
    return {
      auth: {
        testUsers: [],
        randomUsers: [],
        credentials: {
          message: '',
          password: '',
          accounts: [],
        },
      },
      services: {
        organizations: [],
        integrations: [],
        inboxes: [],
        shopifyIntegrations: [],
      },
    }
  }

  /**
   * executeDrizzleSeed performs the drizzle-seed bulk generation step (DEPRECATED - has bugs).
   * @param context - Context from earlier seeding phases.
   * @returns Result from drizzle-seed or null when no refinements are defined.
   */
  private async executeDrizzleSeed(context: SeedingContext): Promise<unknown> {
    const refinements = this.scenario.buildRefinements(context)
    if (!refinements) {
      return null
    }

    // Skip preview to avoid multiple refinement function calls that may cause side effects
    // The refinements function will execute generators, and calling it twice may corrupt state
    const hasRefinements = true

    if (!hasRefinements) {
      this.tracker.info('No drizzle-seed refinements defined; skipping bulk pass')
      return null
    }

    const targetSchema = {
      Product: schema.Product,
      shopify_customers: schema.shopify_customers,
      Thread: schema.Thread,
      AiUsage: schema.AiUsage,
    }

    try {
      console.log('🧪 Starting drizzle-seed refine pass')
      const result = await seed(this.db, targetSchema, {
        count: 0,
        seed: this.config.seedValue,
      }).refine(refinements as never)
      console.log('✅ Drizzle-seed refine pass completed')
      return result
    } catch (error) {
      console.error('❌ Drizzle-seed refine failed', {
        scenario: this.config.scenario,
        message: (error as Error).message,
      })
      console.error(error)
      throw error
    }
  }

  /**
   * resetOrganizationData deletes all seeded data for a specific organization.
   * Respects foreign key constraints by deleting in correct order.
   * Preserves: Users, Members, Billing, Subscriptions, Integrations (credentials only)
   */
  private async resetOrganizationData(organizationId: string): Promise<void> {
    console.log(`🗑️  Resetting data for organization: ${organizationId}`)

    try {
      const { eq } = await import('drizzle-orm')

      // Delete in reverse dependency order (children first, parents last)

      // 1. AI Usage (depends on everything)
      console.log('  ↳ Deleting AI usage data...')
      await this.db.delete(schema.AiUsage).where(eq(schema.AiUsage.organizationId, organizationId))

      // 2. Communication domain (Messages, Threads)
      console.log('  ↳ Deleting message participants...')
      await this.db
        .delete(schema.MessageParticipant)
        .where(eq(schema.MessageParticipant.organizationId, organizationId))

      console.log('  ↳ Deleting tags on threads...')
      await this.db
        .delete(schema.TagOnThread)
        .where(eq(schema.TagOnThread.organizationId, organizationId))

      console.log('  ↳ Deleting messages...')
      await this.db.delete(schema.Message).where(eq(schema.Message.organizationId, organizationId))

      console.log('  ↳ Deleting threads...')
      await this.db.delete(schema.Thread).where(eq(schema.Thread.organizationId, organizationId))

      // 3. Ticket domain
      console.log('  ↳ Deleting ticket relations...')
      await this.db
        .delete(schema.TicketRelation)
        .where(eq(schema.TicketRelation.organizationId, organizationId))

      console.log('  ↳ Deleting ticket assignments...')
      await this.db
        .delete(schema.TicketAssignment)
        .where(eq(schema.TicketAssignment.organizationId, organizationId))

      console.log('  ↳ Deleting ticket replies...')
      await this.db
        .delete(schema.TicketReply)
        .where(eq(schema.TicketReply.organizationId, organizationId))

      console.log('  ↳ Deleting tickets...')
      await this.db.delete(schema.Ticket).where(eq(schema.Ticket.organizationId, organizationId))

      // 4. Commerce domain (Orders → Addresses → Products/Customers)
      console.log('  ↳ Deleting orders...')
      await this.db.delete(schema.Order).where(eq(schema.Order.organizationId, organizationId))

      console.log('  ↳ Deleting addresses...')
      await this.db.delete(schema.Address).where(eq(schema.Address.organizationId, organizationId))

      console.log('  ↳ Deleting products...')
      await this.db.delete(schema.Product).where(eq(schema.Product.organizationId, organizationId))

      console.log('  ↳ Deleting customers...')
      await this.db
        .delete(schema.shopify_customers)
        .where(eq(schema.shopify_customers.organizationId, organizationId))

      // 5. CRM domain (Participants → Contacts)
      console.log('  ↳ Deleting participants...')
      await this.db
        .delete(schema.Participant)
        .where(eq(schema.Participant.organizationId, organizationId))

      console.log('  ↳ Deleting contacts...')
      await this.db.delete(schema.Contact).where(eq(schema.Contact.organizationId, organizationId))

      // 6. Organization domain entities
      console.log('  ↳ Deleting snippets...')
      await this.db.delete(schema.Snippet).where(eq(schema.Snippet.organizationId, organizationId))

      console.log('  ↳ Deleting signatures...')
      await this.db
        .delete(schema.Signature)
        .where(eq(schema.Signature.organizationId, organizationId))

      console.log('  ↳ Deleting tags...')
      await this.db.delete(schema.Tag).where(eq(schema.Tag.organizationId, organizationId))

      console.log(`✅ Organization data reset complete for: ${organizationId}`)
    } catch (error) {
      console.error(`❌ Failed to reset organization data for ${organizationId}:`, error)
      throw error
    }
  }

  /** resetDatabase truncates the schema using drizzle-seed reset helpers. */
  private async resetDatabase(): Promise<void> {
    await reset(this.db, schema)
  }

  /** validateSeeding performs lightweight validation hooks (placeholder for now). */
  private async validateSeeding(): Promise<void> {
    // TODO: implement referential integrity checks and distribution audits
  }

  /**
   * calculateTotalEntities derives a simple entity count from domain results.
   * @param result - Aggregated seeding result.
   * @returns Total estimated entities created.
   */
  private calculateTotalEntities(result: SeedingResult): number {
    const auth = result.domains.auth as
      | { testUsers?: unknown[]; randomUsers?: unknown[] }
      | undefined
    const services = result.domains.services as
      | { organizations?: unknown[]; integrations?: unknown[]; inboxes?: unknown[] }
      | undefined

    const authCount = (auth?.testUsers?.length ?? 0) + (auth?.randomUsers?.length ?? 0)
    const serviceCount =
      (services?.organizations?.length ?? 0) +
      (services?.integrations?.length ?? 0) +
      (services?.inboxes?.length ?? 0)

    return authCount + serviceCount
  }

  /**
   * isBillingPlansOnly determines whether billing seeding should skip Stripe operations.
   * @returns True when only plans should be created without Stripe resources.
   */
  private isBillingPlansOnly(): boolean {
    if (typeof this.config.billingPlansOnly === 'boolean') {
      return this.config.billingPlansOnly
    }

    const envValue = process.env.SEED_BILLING_PLANS_ONLY
    return envValue === 'true' || envValue === '1'
  }
}
