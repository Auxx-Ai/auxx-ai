// lib/organization/organization-seeder.ts

import { SubscriptionService } from '@auxx/billing'
import { WEBAPP_URL } from '@auxx/config/server'
import { configService } from '@auxx/credentials'
import { type Database, schema } from '@auxx/database'
import { EmailTemplateType } from '@auxx/database/enums'
import { isSelfHosted } from '@auxx/deployment'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { SystemModelService } from '../ai/providers/system-model-service'
import { DEFAULT_QUOTA_LIMITS, ModelType, ProviderQuotaType } from '../ai/providers/types'
import { InboxService } from '../inboxes'
import { KBService } from '../kb'
import { UnifiedCrudHandler } from '../resources/crud'
import { SettingsInitializer } from '../settings/settings-initializer'
import { EntitySeeder } from './entity-seeder'
import { SYSTEM_ENTITIES } from './entity-seeder/constants'

const logger = createScopedLogger('organization-seeder')

// Default system model defaults for new organizations (OpenAI as default provider)
const DEFAULT_SYSTEM_MODELS: Array<{
  modelType: ModelType
  provider: string
  model: string
}> = [
  { modelType: ModelType.LLM, provider: 'openai', model: 'gpt-5.4-nano' },
  { modelType: ModelType.TEXT_EMBEDDING, provider: 'openai', model: 'text-embedding-3-small' },
  { modelType: ModelType.MODERATION, provider: 'openai', model: 'omni-moderation-latest' },
  { modelType: ModelType.VISION, provider: 'openai', model: 'gpt-5.4-nano' },
  { modelType: ModelType.TTS, provider: 'openai', model: 'tts-1' },
  { modelType: ModelType.SPEECH2TEXT, provider: 'openai', model: 'whisper-1' },
]

// Default ticket sequence settings
const defaultTicketSequence = {
  currentNumber: 0,
  prefix: 'TKT',
  paddingLength: 4,
  usePrefix: true,
  useDateInPrefix: false,
  dateFormat: 'YYMM',
  separator: '-',
  useSuffix: false,
}
// Default email templates for the organization
const defaultEmailTemplates = [
  {
    name: 'Ticket Created',
    description: 'Default template for when a ticket is created',
    type: EmailTemplateType.TICKET_CREATED,
    subject: 'Your ticket #{ticket.number} has been created',
    bodyHtml: `<p>Hello {customer.firstName},</p>
<p>Your ticket #{ticket.number} has been created. Our support team will review your request shortly.</p>
<p>Ticket details:</p>
<ul>
  <li>Subject: {ticket.title}</li>
  <li>Status: {ticket.status}</li>
</ul>
<p>You can reply directly to this email to add more information.</p>
<p>Thank you,<br>
Support Team</p>`,
    bodyPlain: `Hello {customer.firstName},

Your ticket #{ticket.number} has been created. Our support team will review your request shortly.

Ticket details:
- Subject: {ticket.title}
- Status: {ticket.status}

You can reply directly to this email to add more information.

Thank you,
Support Team`,
    variables: JSON.stringify({
      ticket: ['number', 'title', 'status'],
      customer: ['firstName', 'lastName'],
    }),
    isDefault: true,
    isActive: true,
  },
  {
    name: 'Ticket Replied',
    description: 'Default template for when an agent replies to a ticket',
    type: EmailTemplateType.TICKET_REPLIED,
    subject: 'Update on your ticket #{ticket.number}',
    bodyHtml: `<p>Hello {customer.firstName},</p>
<p>Your ticket has been updated with a new response from our team.</p>
<p>You can view the response and reply by responding directly to this email.</p>
<p>Thank you,<br>
Support Team</p>`,
    bodyPlain: `Hello {customer.firstName},

Your ticket has been updated with a new response from our team.

You can view the response and reply by responding directly to this email.

Thank you,
Support Team`,
    variables: JSON.stringify({ ticket: ['number'], customer: ['firstName', 'lastName'] }),
    isDefault: true,
    isActive: true,
  },
]

/** Options for seedNewOrganization */
export interface SeedOrganizationOptions {
  /** When true, skips trial subscription and creates a demo plan subscription instead */
  isDemo?: boolean
}

export class OrganizationSeeder {
  private db: Database
  private userId: string
  private userEmail?: string

  constructor(db: Database, userId: string, userEmail?: string) {
    this.db = db
    this.userId = userId
    this.userEmail = userEmail
  }
  /**
   * Seed a new organization with all necessary default data
   * This method should be called whenever a new organization is created
   * @param organizationId The organization ID to seed
   * @param options Optional configuration (e.g. isDemo flag)
   */
  async seedNewOrganization(
    organizationId: string,
    options?: SeedOrganizationOptions
  ): Promise<void> {
    const isDemo = options?.isDemo ?? false
    logger.info('Starting seeding process for new organization', { organizationId, isDemo })
    try {
      // Initialize settings first as other components may depend on them
      await this.seedSettings(organizationId)
      // Seed system entities first as other components may reference them
      await this.seedEntities(organizationId)
      // Seed all other components in parallel for better performance
      await Promise.all([
        this.seedInboxes(organizationId),
        this.seedTags(organizationId),
        this.seedEmailTemplates(organizationId),
        this.seedTicketSequence(organizationId),
        this.seedKnowledgeBase(organizationId),
        isDemo
          ? this.seedDemoSubscription(organizationId)
          : this.seedTrialSubscription(organizationId),
        this.seedAiProviderQuotas(organizationId),
        this.seedSystemModelDefaults(organizationId),
      ])
      logger.info('Successfully completed seeding for organization', { organizationId })

      // Enqueue async example data seeding (companies, contacts, threads, workflow).
      // Skip for demo signups — the /demo route owns its own seeding flow and will
      // enqueue a demo-scenario orgSeedJob of its own. Mirrors seedTrialSubscription's
      // demo-email check. Non-fatal on enqueue failure.
      const { getDemoEmailDomain } = await import('../demo')
      const isDemoEmail = !!this.userEmail && this.userEmail.endsWith(`@${getDemoEmailDomain()}`)

      if (!isDemo && !isDemoEmail) {
        try {
          const { getQueue, Queues } = await import('../jobs/queues')
          await getQueue(Queues.maintenanceQueue).add(
            'orgSeedJob',
            {
              organizationId,
              userId: this.userId,
              userEmail: this.userEmail,
              scenario: 'example' as const,
            },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
              removeOnComplete: { age: 300 },
              removeOnFail: { count: 10 },
            }
          )
        } catch (error) {
          logger.error('Failed to enqueue orgSeedJob (example)', { organizationId, error })
        }
      }
    } catch (error) {
      logger.error('Failed to seed organization', { organizationId, error })
      throw error
    }
  }
  /**
   * Seeds the default email templates for the given organization.
   * @param db - drizzle instance
   * @param organizationId - ID of the organization to seed templates for
   */
  private async seedEmailTemplates(organizationId: string) {
    logger.info(`Seeding email templates for organization: ${organizationId}`)
    // Create default email templates for the organization
    await Promise.all(
      defaultEmailTemplates.map((template) =>
        this.db
          .insert(schema.EmailTemplate)
          .values({ ...template, organizationId, updatedAt: new Date() })
      )
    )
    logger.info(`Email templates seeded for organization: ${organizationId}`)
  }
  private async seedTicketSequence(organizationId: string) {
    logger.info(`Seeding ticket sequence for organization: ${organizationId}`)
    await this.db
      .insert(schema.TicketSequence)
      .values({ ...defaultTicketSequence, organizationId, updatedAt: new Date() })
  }
  /**
   * Seeds the article categories for the given organization.
   * @param db - drizzle instance
   * @param organizationId - ID of the organization to seed categories for
   */
  private async seedKnowledgeBase(organizationId: string) {
    const kbService = new KBService(this.db, organizationId)
    const kb = await kbService.createKnowledgeBase(
      {
        name: 'Knowledge Base',
        description: 'Default knowledge base for the organization',
        slug: 'knowledge-base',
      },
      this.userId
    )
    await kbService.createArticle(
      kb.id,
      { title: 'Welcome to the Knowledge Base', content: 'This is the default article.' },
      this.userId
    )
  }

  /**
   * Seed default tags for a new organization using the unified entity system.
   * Creates a hierarchical tag structure with a parent "Topic Categorization" tag
   * and child tags, plus independent top-level tags.
   */
  private async seedTags(organizationId: string) {
    const handler = new UnifiedCrudHandler(organizationId, this.userId, this.db)

    // Skip snapshot invalidation and events during seeding — no active users to notify,
    // and each invalidation attempt costs 5s on Lambda when Redis is slow/unavailable
    const seedOpts = { skipSnapshotInvalidation: true, skipEvents: true }

    // Create parent tag first - Topic Categorization
    // UnifiedCrudHandler.create() throws on error, so if we get a result, it succeeded
    const topicResult = await handler.create(
      'tag',
      {
        title: 'Topic Categorization',
        tag_description: 'Top-level categorization for support tickets',
        tag_emoji: '🏷️',
        tag_color: 'blue',
      },
      seedOpts
    )

    // Create child tags under Topic Categorization using parent relationship
    // Must be sequential to avoid inverse relationship sync conflicts (sortKey collisions)
    const topicSubTags = [
      { title: 'Account Management', tag_emoji: '👤', tag_color: 'red' },
      { title: 'Billing', tag_emoji: '💳', tag_color: 'green' },
      { title: 'Customer Feedback', tag_emoji: '💬', tag_color: 'orange' },
      { title: 'Legal', tag_emoji: '⚖️', tag_color: 'gray' },
      { title: 'Sales', tag_emoji: '💼', tag_color: 'pink' },
      { title: 'Security', tag_emoji: '🔒', tag_color: 'purple' },
      { title: 'Shipping', tag_emoji: '🚚', tag_color: 'amber' },
      { title: 'Troubleshooting', tag_emoji: '🛠️', tag_color: 'teal' },
    ]

    for (const tag of topicSubTags) {
      await handler.create(
        'tag',
        {
          ...tag,
          tag_parent: topicResult.recordId, // Link to parent via RecordId
        },
        seedOpts
      )
    }

    // Create independent tags (no parent) - can be parallel since no inverse sync needed
    const independentTags = [
      { title: 'Support', tag_emoji: '🆘', tag_color: 'red' },
      { title: 'Urgent', tag_emoji: '🚨', tag_color: 'purple' },
      { title: 'Orders', tag_emoji: '📦', tag_color: 'amber' },
      { title: 'VIP', tag_emoji: '⭐', tag_color: 'orange' },
    ]

    await Promise.all(independentTags.map((tag) => handler.create('tag', tag, seedOpts)))
  }
  // Create ticket sequence for the organization
  /**
   * Initialize default settings for a new organization
   * @param organizationId The organization ID
   */
  private async seedSettings(organizationId: string): Promise<void> {
    logger.info('Initializing settings for organization', { organizationId })
    const settingsInitializer = new SettingsInitializer(this.db)
    await settingsInitializer.initializeOrganizationSettings(organizationId)
    logger.info('Successfully initialized settings for organization', { organizationId })
  }

  /**
   * Seed system entities (Contact, Ticket, Part) with their custom fields
   * @param organizationId The organization ID
   */
  private async seedEntities(organizationId: string): Promise<void> {
    logger.info('Seeding system entities for organization', { organizationId })
    const entitySeeder = new EntitySeeder(this.db, organizationId)
    await entitySeeder.seedSystemEntities()
    logger.info('Successfully seeded system entities for organization', { organizationId })
  }
  /**
   * Create default inboxes for a new organization
   * @param organizationId The organization ID
   */
  private async seedInboxes(organizationId: string): Promise<void> {
    logger.info('Creating default inboxes for organization', { organizationId })
    const inboxService = new InboxService(this.db, organizationId, this.userId)
    // Create a default shared inbox
    const defaultInbox = await inboxService.createInbox({
      name: 'Shared Inbox',
      description: 'Default shared inbox for all team members',
      color: 'blue',
      status: 'ACTIVE',
      visibility: 'org_members', // All members have access by default
    })
    logger.info('Created default shared inbox', { organizationId, inboxId: defaultInbox.id })
    // You can create additional default inboxes here if needed
    logger.info('Successfully created default inboxes for organization', { organizationId })
  }
  /**
   * Create a trial subscription for the organization
   * @param organizationId The organization ID
   */
  private async seedTrialSubscription(organizationId: string): Promise<void> {
    // Self-hosted: no trial subscriptions needed
    if (isSelfHosted()) {
      logger.info('Self-hosted mode, skipping trial subscription', { organizationId })
      return
    }

    const enableAutoTrial = configService.get<string>('ENABLE_AUTO_TRIAL') !== 'false'
    if (!enableAutoTrial) {
      logger.info('Auto trial disabled, skipping trial subscription', { organizationId })
      return
    }

    if (!this.userEmail) {
      logger.warn('No email provided, skipping trial subscription', { organizationId })
      return
    }

    // Demo accounts use a separate subscription flow — skip trial
    const { getDemoEmailDomain } = await import('../demo')
    if (this.userEmail.endsWith(`@${getDemoEmailDomain()}`)) {
      logger.info('Demo account detected, skipping trial subscription', { organizationId })
      return
    }

    // Check if Stripe is configured
    if (!configService.get<string>('STRIPE_SECRET_KEY')) {
      logger.warn('Stripe not configured, skipping trial subscription', { organizationId })
      return
    }

    const baseUrl = WEBAPP_URL
    const trialPlan = configService.get<string>('TRIAL_PLAN_NAME') || 'Growth'
    const trialDays = parseInt(configService.get<string>('TRIAL_DAYS') || '14', 10)

    logger.info('Creating trial subscription for organization', {
      organizationId,
      trialPlan,
      trialDays,
    })

    try {
      const subscriptionService = new SubscriptionService(this.db, baseUrl)

      await subscriptionService.createTrialSubscription({
        organizationId,
        planName: trialPlan,
        userEmail: this.userEmail,
        trialDays,
      })

      logger.info('Successfully created trial subscription', { organizationId })
    } catch (error: any) {
      logger.error('Failed to create trial subscription', {
        organizationId,
        error: error.message,
      })
      // Don't throw - we don't want to block org creation if trial fails
    }
  }

  /**
   * Create a demo plan subscription for the organization (no Stripe, no trial)
   * @param organizationId The organization ID
   */
  private async seedDemoSubscription(organizationId: string): Promise<void> {
    logger.info('Creating demo subscription for organization', { organizationId })

    try {
      // Find the Demo plan by name
      const [demoPlan] = await this.db
        .select({ id: schema.Plan.id })
        .from(schema.Plan)
        .where(eq(schema.Plan.name, 'Demo'))
        .limit(1)

      if (!demoPlan) {
        logger.warn('Demo plan not found in database, skipping demo subscription', {
          organizationId,
        })
        return
      }

      await this.db.insert(schema.PlanSubscription).values({
        organizationId,
        planId: demoPlan.id,
        plan: 'Demo',
        status: 'active',
        billingCycle: 'MONTHLY',
        seats: 1,
        updatedAt: new Date(),
      })

      logger.info('Successfully created demo subscription', { organizationId })
    } catch (error: any) {
      logger.error('Failed to create demo subscription', {
        organizationId,
        error: error.message,
      })
      // Don't throw - we don't want to block org creation if subscription fails
    }
  }

  /**
   * Update an existing organization with any new defaults
   * This is useful when you've added new features that need initialization
   * @param organizationId The organization ID to update
   */
  async updateExistingOrganization(organizationId: string): Promise<void> {
    logger.info('Updating existing organization with new defaults', { organizationId })
    try {
      // Update with any new settings
      const settingsInitializer = new SettingsInitializer(this.db)
      await settingsInitializer.updateOrganizationWithNewSettings(organizationId)
      // Check if organization has the required inboxes, create if missing
      await this.ensureDefaultInboxes(organizationId)
      // Check if organization has system entities, create if missing
      await this.ensureSystemEntities(organizationId)
      // Add other update functions as needed
      logger.info('Successfully updated existing organization', { organizationId })
    } catch (error) {
      logger.error('Failed to update existing organization', { organizationId, error })
      throw error
    }
  }
  /**
   * Ensure an organization has the required default inboxes
   * @param organizationId The organization ID
   */
  private async ensureDefaultInboxes(organizationId: string): Promise<void> {
    const inboxService = new InboxService(this.db, organizationId, this.userId)
    // Get existing inboxes
    const existingInboxes = await inboxService.getInboxes()
    // If no inboxes exist, create the default one
    if (existingInboxes.length === 0) {
      logger.info('No inboxes found, creating default inbox', { organizationId })
      await inboxService.createInbox({
        name: 'Shared Inbox',
        description: 'Default shared inbox for all team members',
        color: 'blue',
        status: 'ACTIVE',
        visibility: 'org_members',
      })
      logger.info('Created default inbox for existing organization', { organizationId })
    }
  }

  /**
   * Ensure an organization has the required system entities (Contact, Ticket, Part)
   * @param organizationId The organization ID
   */
  private async ensureSystemEntities(organizationId: string): Promise<void> {
    // Check if system entities already exist
    const existingEntities = await this.db
      .select({ entityType: schema.EntityDefinition.entityType })
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.organizationId, organizationId))

    const entityTypes = existingEntities.map((e) => e.entityType)

    // If any system entities are missing, seed them all
    const requiredEntities = SYSTEM_ENTITIES.map((e) => e.entityType)
    if (requiredEntities.some((et) => !entityTypes.includes(et))) {
      logger.info('System entities missing, seeding for existing organization', { organizationId })
      const entitySeeder = new EntitySeeder(this.db, organizationId)
      await entitySeeder.seedSystemEntities()
      logger.info('Successfully seeded system entities for existing organization', {
        organizationId,
      })
    }
  }

  /**
   * Initialize AI provider rows + the org-level AI credit pool for a new organization.
   * - Creates SYSTEM provider configuration rows for supported providers (without quota — quota is org-level)
   * - Sets a SYSTEM provider preference by default
   * - Writes the OrganizationAiQuota row with the trial/free allowance
   */
  private async seedAiProviderQuotas(organizationId: string): Promise<void> {
    logger.info('Seeding AI provider quotas for organization', { organizationId })

    const now = new Date()
    const periodEnd = new Date(now)
    periodEnd.setMonth(periodEnd.getMonth() + 1)

    const providers = ['openai', 'anthropic']

    for (const provider of providers) {
      await this.db
        .insert(schema.ProviderConfiguration)
        .values({
          organizationId,
          provider,
          providerType: 'SYSTEM',
          isEnabled: true,
          updatedAt: now,
        })
        .onConflictDoNothing()

      await this.db
        .insert(schema.ProviderPreference)
        .values({
          organizationId,
          provider,
          preferredType: 'SYSTEM',
          updatedAt: now,
        })
        .onConflictDoNothing()
    }

    // Org-level credit pool. Self-hosted = unlimited, cloud = trial (200) by default;
    // the Stripe `subscription.updated` webhook will later realign it to the plan's
    // actual `monthlyAiCredits`.
    const quotaType = isSelfHosted() ? ProviderQuotaType.PAID : ProviderQuotaType.TRIAL
    const quotaLimit = isSelfHosted() ? -1 : DEFAULT_QUOTA_LIMITS[ProviderQuotaType.TRIAL]

    await this.db
      .insert(schema.OrganizationAiQuota)
      .values({
        organizationId,
        quotaType,
        quotaLimit,
        quotaUsed: 0,
        quotaPeriodStart: now,
        quotaPeriodEnd: periodEnd,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()

    logger.info('Successfully seeded AI provider quotas', { organizationId, providers })
  }

  /**
   * Seed default system model selections for a new organization
   * Sets OpenAI models as defaults so users have a working setup out of the box
   * @param organizationId The organization ID
   */
  private async seedSystemModelDefaults(organizationId: string): Promise<void> {
    logger.info('Seeding system model defaults for organization', { organizationId })
    const service = new SystemModelService(this.db, organizationId)
    for (const { modelType, provider, model } of DEFAULT_SYSTEM_MODELS) {
      await service.setDefault(modelType, provider, model)
    }
    logger.info('Successfully seeded system model defaults', { organizationId })
  }
}
