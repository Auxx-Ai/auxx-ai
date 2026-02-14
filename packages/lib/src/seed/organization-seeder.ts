// lib/organization/organization-seeder.ts

import { SubscriptionService } from '@auxx/billing'
import { env, WEBAPP_URL } from '@auxx/config/server'
import { type Database, schema } from '@auxx/database'
import { EmailTemplateType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { DEFAULT_QUOTA_LIMITS, ProviderQuotaType } from '../ai/providers/types'
import { InboxService } from '../inboxes'
import { KBService } from '../kb'
import { UnifiedCrudHandler } from '../resources/crud'
import { SettingsInitializer } from '../settings/settings-initializer'
import { EntitySeeder } from './entity-seeder'
import { SYSTEM_ENTITIES } from './entity-seeder/constants'

const logger = createScopedLogger('organization-seeder')

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
   */
  async seedNewOrganization(organizationId: string): Promise<void> {
    logger.info('Starting seeding process for new organization', { organizationId })
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
        this.seedTrialSubscription(organizationId),
        this.seedAiProviderQuotas(organizationId),
      ])
      logger.info('Successfully completed seeding for organization', { organizationId })
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

    // Create parent tag first - Topic Categorization
    // UnifiedCrudHandler.create() throws on error, so if we get a result, it succeeded
    const topicResult = await handler.create('tag', {
      title: 'Topic Categorization',
      tag_description: 'Top-level categorization for support tickets',
      tag_emoji: '🏷️',
      tag_color: '#A7C1F2',
    })

    // Create child tags under Topic Categorization using parent relationship
    // Must be sequential to avoid inverse relationship sync conflicts (sortKey collisions)
    const topicSubTags = [
      { title: 'Account Management', tag_emoji: '👤', tag_color: '#F2A99B' },
      { title: 'Billing', tag_emoji: '💳', tag_color: '#B9E3B9' },
      { title: 'Customer Feedback', tag_emoji: '💬', tag_color: '#F5C8A3' },
      { title: 'Legal', tag_emoji: '⚖️', tag_color: '#8D8D8D' },
      { title: 'Sales', tag_emoji: '💼', tag_color: '#D7A4D3' },
      { title: 'Security', tag_emoji: '🔒', tag_color: '#C9B6F2' },
      { title: 'Shipping', tag_emoji: '🚚', tag_color: '#F5E7A3' },
      { title: 'Troubleshooting', tag_emoji: '🛠️', tag_color: '#A7D8E2' },
    ]

    for (const tag of topicSubTags) {
      await handler.create('tag', {
        ...tag,
        tag_parent: topicResult.recordId, // Link to parent via RecordId
      })
    }

    // Create independent tags (no parent) - can be parallel since no inverse sync needed
    const independentTags = [
      { title: 'Support', tag_emoji: '🆘', tag_color: '#F2A99B' },
      { title: 'Urgent', tag_emoji: '🚨', tag_color: '#C9B6F2' },
      { title: 'Orders', tag_emoji: '📦', tag_color: '#F5E7A3' },
      { title: 'VIP', tag_emoji: '⭐', tag_color: '#F5C8A3' },
    ]

    await Promise.all(independentTags.map((tag) => handler.create('tag', tag)))
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
      color: '#A7C1F2', // Light Blue
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
    const enableAutoTrial = env.ENABLE_AUTO_TRIAL !== 'false'
    if (!enableAutoTrial) {
      logger.info('Auto trial disabled, skipping trial subscription', { organizationId })
      return
    }

    if (!this.userEmail) {
      logger.warn('No email provided, skipping trial subscription', { organizationId })
      return
    }

    // Check if Stripe is configured
    if (!env.STRIPE_SECRET_KEY) {
      logger.warn('Stripe not configured, skipping trial subscription', { organizationId })
      return
    }

    const baseUrl = WEBAPP_URL
    const trialPlan = env.TRIAL_PLAN_NAME || 'Growth'
    const trialDays = parseInt(env.TRIAL_DAYS || '14', 10)

    logger.info('Creating trial subscription for organization', {
      organizationId,
      trialPlan,
      trialDays,
    })

    try {
      // Initialize Stripe client if not already initialized
      const { stripeClient } = await import('@auxx/billing')
      stripeClient.initialize(env.STRIPE_SECRET_KEY)

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
        color: '#A7C1F2', // Light Blue
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
   * Initialize AI provider quotas and preferences for a new organization
   * Sets up free tier system credentials with monthly quota limits
   * @param organizationId The organization ID
   */
  private async seedAiProviderQuotas(organizationId: string): Promise<void> {
    logger.info('Seeding AI provider quotas for organization', { organizationId })

    const now = new Date()
    const periodEnd = new Date(now)
    periodEnd.setMonth(periodEnd.getMonth() + 1) // Monthly reset

    // Providers that support system credentials
    const providers = ['openai', 'anthropic']

    for (const provider of providers) {
      // Create system provider configuration with free tier quota
      await this.db
        .insert(schema.ProviderConfiguration)
        .values({
          organizationId,
          provider,
          providerType: 'SYSTEM',
          isEnabled: true,
          quotaType: ProviderQuotaType.FREE,
          quotaLimit: DEFAULT_QUOTA_LIMITS[ProviderQuotaType.FREE],
          quotaUsed: 0,
          quotaPeriodStart: now,
          quotaPeriodEnd: periodEnd,
          updatedAt: now,
        })
        .onConflictDoNothing()

      // Set preference to system by default (use platform credentials)
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

    logger.info('Successfully seeded AI provider quotas', { organizationId, providers })
  }
}
