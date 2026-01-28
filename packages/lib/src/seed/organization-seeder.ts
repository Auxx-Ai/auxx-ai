// lib/organization/organization-seeder.ts
import { database as db, schema, type Database } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { InboxService } from '../inboxes'
import { SettingsInitializer } from '../settings/settings-initializer'
import { createScopedLogger } from '@auxx/logger'
import { TagService } from '../tags/tag-service'
import { KBService } from '../kb'
import { EmailTemplateType } from '@auxx/database/enums'
import { SubscriptionService } from '@auxx/billing'
import { env } from '@auxx/config/server'
import { WEBAPP_URL } from '@auxx/config/server'
import { DEFAULT_QUOTA_LIMITS, ProviderQuotaType } from '../ai/providers/types'
import { EntitySeeder } from './entity-seeder'

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
   * @param userId The user ID to associate with the organization
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

  private async seedTags(organizationId: string) {
    const tagService = new TagService(organizationId, this.userId, this.db)
    // Topic Categorization parent tag
    const topicCategorizationTag = await tagService.createTag({
      title: 'Topic Categorization',
      description: 'Top-level categorization for support tickets',
      emoji: '🏷️',
      color: '#A7C1F2', // Light Blue
    })
    // Sub-tags under Topic Categorization
    const topicSubTags = [
      {
        title: 'Account Management',
        emoji: '👤',
        color: '#F2A99B', // Coral
        parentId: topicCategorizationTag.id,
      },
      {
        title: 'Billing',
        emoji: '💳',
        color: '#B9E3B9', // Light Green
        parentId: topicCategorizationTag.id,
      },
      {
        title: 'Customer Feedback',
        emoji: '💬',
        color: '#F5C8A3', // Peach
        parentId: topicCategorizationTag.id,
      },
      {
        title: 'Legal',
        emoji: '⚖️',
        color: '#8D8D8D', // Gray
        parentId: topicCategorizationTag.id,
      },
      {
        title: 'Sales',
        emoji: '💼',
        color: '#D7A4D3', // Pink
        parentId: topicCategorizationTag.id,
      },
      {
        title: 'Security',
        emoji: '🔒',
        color: '#C9B6F2', // Purple
        parentId: topicCategorizationTag.id,
      },
      {
        title: 'Shipping',
        emoji: '🚚',
        color: '#F5E7A3', // Light Yellow
        parentId: topicCategorizationTag.id,
      },
      {
        title: 'Troubleshooting',
        emoji: '🛠️',
        color: '#A7D8E2', // Light Blue
        parentId: topicCategorizationTag.id,
      },
    ]
    // Create sub-tags
    const createdTopicSubTags = await Promise.all(
      topicSubTags.map((tag) => tagService.createTag(tag))
    )
    // Independent tags
    const independentTags = [
      { title: 'Support', emoji: '🆘', color: '#F2A99B' },
      { title: 'Urgent', emoji: '🚨', color: '#C9B6F2' },
      { title: 'Orders', emoji: '📦', color: '#F5E7A3' },
      { title: 'VIP', emoji: '⭐', color: '#F5C8A3' },
    ]
    // Create independent tags
    const createdIndependentTags = await Promise.all(
      independentTags.map((tag) => tagService.createTag(tag))
    )
    logger.info(`Seeded tags for organization: ${organizationId}`, {
      topicCategorizationTag: topicCategorizationTag.id,
      topicSubTags: createdTopicSubTags.map((t) => t.id),
      independentTags: createdIndependentTags.map((t) => t.id),
    })
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
    const requiredEntities = ['contact', 'ticket', 'part', 'inbox']
    if (requiredEntities.some((et) => !entityTypes.includes(et))) {
      logger.info('System entities missing, seeding for existing organization', { organizationId })
      const entitySeeder = new EntitySeeder(this.db, organizationId)
      await entitySeeder.seedSystemEntities()
      logger.info('Successfully seeded system entities for existing organization', { organizationId })
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
