// lib/organization/organization-seeder.ts

import { SubscriptionService } from '@auxx/billing'
import { WEBAPP_URL } from '@auxx/config/server'
import { configService } from '@auxx/credentials'
import { type Database, schema } from '@auxx/database'
import { EmailTemplateType } from '@auxx/database/enums'
import { isSelfHosted } from '@auxx/deployment'
import { createScopedLogger } from '@auxx/logger'
import { eq, sql } from 'drizzle-orm'
import { SystemModelService } from '../ai/providers/system-model-service'
import { DEFAULT_QUOTA_LIMITS, ModelType, ProviderQuotaType } from '../ai/providers/types'
import { InboxService } from '../inboxes'
import { KBService } from '../kb'
import { seedSuggestedMailFilters } from '../mail-filters'
import { ensureSystemProfiles } from '../permissions/profiles'
import { seedSuggestedRecordRules } from '../record-rules'
import { UnifiedCrudHandler } from '../resources/crud'
import { seedClientNotificationSequences } from '../sequences'
import { buildSystemSnippetTemplates } from '../snippets'
import { SystemUserService } from '../users/system-user-service'
import { seedAiCategoryTags } from './ai-category-tags'
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

// Default record sequence settings — one row per scope (ticket / work_order / service_request / quote / invoice)
const defaultRecordSequences = [
  {
    scope: 'ticket',
    prefix: 'TKT',
    currentNumber: 0,
    paddingLength: 4,
    usePrefix: true,
    useDateInPrefix: false,
    dateFormat: 'YYMM',
    separator: '-',
    useSuffix: false,
  },
  {
    scope: 'work_order',
    prefix: 'WO',
    currentNumber: 0,
    paddingLength: 4,
    usePrefix: true,
    useDateInPrefix: false,
    dateFormat: 'YYMM',
    separator: '-',
    useSuffix: false,
  },
  {
    scope: 'service_request',
    prefix: 'REQ',
    currentNumber: 0,
    paddingLength: 4,
    usePrefix: true,
    useDateInPrefix: false,
    dateFormat: 'YYMM',
    separator: '-',
    useSuffix: false,
  },
  {
    scope: 'quote',
    prefix: 'QUO',
    currentNumber: 0,
    paddingLength: 4,
    usePrefix: true,
    useDateInPrefix: false,
    dateFormat: 'YYMM',
    separator: '-',
    useSuffix: false,
  },
  {
    scope: 'invoice',
    prefix: 'INV',
    currentNumber: 0,
    paddingLength: 4,
    usePrefix: true,
    useDateInPrefix: false,
    dateFormat: 'YYMM',
    separator: '-',
    useSuffix: false,
  },
]
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
  private signupSource?: string

  constructor(db: Database, userId: string, userEmail?: string, signupSource?: string) {
    this.db = db
    this.userId = userId
    this.userEmail = userEmail
    this.signupSource = signupSource
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
      // Settings v2: no eager row creation — catalog defaults merge at read time
      // and rows are created lazily on first write (see settings/settings-service.ts).
      // System permission profiles — every principal's null binding resolves to one
      // of these rows in code (§1.3). Idempotent, and deliberately duplicated: the
      // two in-transaction callers (`createOrganization`, `seedNewUserDatabase`) and
      // the seed CLI's `ensureOrganization` each seed first, but
      // `seedNewOrganization` must stand alone so a future caller cannot create an
      // org without profiles. See plans/permissions/v2/19-permission-profiles.md §5.2.
      await ensureSystemProfiles(organizationId, this.db)
      // Seed system entities first as other components may reference them
      await this.seedEntities(organizationId)
      // Seed all other components in parallel for better performance
      await Promise.all([
        this.seedInboxes(organizationId),
        this.seedTags(organizationId),
        this.seedEmailTemplates(organizationId),
        this.seedSystemSnippets(organizationId),
        this.seedTicketSequence(organizationId),
        this.seedKnowledgeBase(organizationId),
        this.seedClientNotificationSequences(organizationId),
        this.seedSuggestedRecordRules(organizationId),
        isDemo
          ? this.seedDemoSubscription(organizationId)
          : this.seedTrialSubscription(organizationId),
        this.seedAiProviderQuotas(organizationId),
        this.seedSystemModelDefaults(organizationId),
      ])
      // AFTER the parallel step, not inside it: suggested mail filters need the default
      // shared inbox `seedInboxes` creates (a `MailFilter` requires a NOT NULL `inboxId`,
      // and that inbox IS the containment boundary) and the tags `seedTags` creates. Both
      // are members of the `Promise.all` above, so racing this alongside them would make
      // the seed a coin flip that silently degrades to "no shared inbox — skipped".
      // `seedSuggestedRecordRules` can sit in the parallel block because its dependency
      // (the contact `EntityDefinition`) is seeded before it, by `seedEntities`.
      await this.seedSuggestedMailFilters(organizationId)
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
  /**
   * Seed the system snippets (`quote_email` — money MQ2; `invoice_email` — MI1) for a
   * new organization, keyed to its just-seeded `EntityDefinition` cuids. Runs after
   * `seedEntities` so the quote/invoice/contact defs already exist —
   * `buildSystemSnippetTemplates` returns both templates once `entityDefs.quote`/
   * `entityDefs.invoice` + `entityDefs.contact` are all present, and simply omits
   * whichever def is still missing (e.g. an org seeded before MI1 shipped, until its
   * entity migration runs). NOT the only path that creates these rows —
   * `getSystemSnippet` lazily materializes them for pre-existing orgs on first read.
   */
  private async seedSystemSnippets(organizationId: string): Promise<void> {
    logger.info(`Seeding system snippets for organization: ${organizationId}`)

    const defs = await this.db
      .select({ entityType: schema.EntityDefinition.entityType, id: schema.EntityDefinition.id })
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.organizationId, organizationId))

    const entityDefs: Record<string, string> = {}
    for (const def of defs) {
      if (def.entityType) entityDefs[def.entityType] = def.id
    }

    const templates = buildSystemSnippetTemplates(entityDefs)
    if (templates.length === 0) {
      logger.warn('No system snippet templates available yet (quote/contact defs missing)', {
        organizationId,
      })
      return
    }

    const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)

    await this.db
      .insert(schema.Snippet)
      .values(
        templates.map((template) => ({
          title: template.title,
          content: template.content,
          contentHtml: template.contentHtml,
          systemType: template.systemType,
          organizationId,
          createdById: systemUserId,
          updatedAt: new Date(),
        }))
      )
      .onConflictDoNothing({
        target: [schema.Snippet.systemType, schema.Snippet.organizationId],
        where: sql`${schema.Snippet.systemType} IS NOT NULL AND ${schema.Snippet.isDeleted} = false`,
      })

    logger.info(`System snippets seeded for organization: ${organizationId}`)
  }
  /**
   * Seed the 5 client-notification sequences (plans/dispatch/19-client-notifications.md §4.6)
   * — visit reminders, en-route, job follow-up, invoice reminders, and the opt-in visit
   * follow-up. All seeded `status='disabled'`; idempotent on `(organizationId, templateKey)`.
   * Thin wrapper around the domain function so the existing-org backfill script
   * (`scripts/backfill-client-notification-sequences.ts`) can call the exact same logic.
   */
  private async seedClientNotificationSequences(organizationId: string): Promise<void> {
    logger.info(`Seeding client-notification sequences for organization: ${organizationId}`)
    await seedClientNotificationSequences(this.db, organizationId)
    logger.info(`Client-notification sequences seeded for organization: ${organizationId}`)
  }
  /**
   * Seed the 3 starter suggested record rules (plans/signals/06-follow-ups-build.md decision
   * 8) — unsubscribe-flag, hard-bounce-review, hot-contact-follow-up. All seeded
   * `enabled: false` on the contact `EntityDefinition`; idempotent on
   * `(organizationId, templateKey)`. Thin wrapper around the domain function so the
   * existing-org backfill script (`scripts/backfill-suggested-record-rules.ts`) can call the
   * exact same logic.
   */
  private async seedSuggestedRecordRules(organizationId: string): Promise<void> {
    logger.info(`Seeding suggested record rules for organization: ${organizationId}`)
    await seedSuggestedRecordRules(this.db, organizationId)
    logger.info(`Suggested record rules seeded for organization: ${organizationId}`)
  }
  /**
   * Seed the starter suggested mail filters (plans/mail-filter/02-mail-filters-plan.md §9
   * phase 5) on the org's default shared inbox. All seeded `enabled: false`; idempotent on
   * `(organizationId, templateKey)`; excluded from `countBillableMailFilters`. Thin wrapper
   * around the domain function so the existing-org backfill script
   * (`scripts/backfill-suggested-mail-filters.ts`) can call the exact same logic.
   *
   * Runs AFTER the parallel seed step — see the call site: the inbox and the tags it
   * resolves are created in there.
   */
  private async seedSuggestedMailFilters(organizationId: string): Promise<void> {
    logger.info(`Seeding suggested mail filters for organization: ${organizationId}`)
    await seedSuggestedMailFilters(this.db, organizationId)
    logger.info(`Suggested mail filters seeded for organization: ${organizationId}`)
  }
  private async seedTicketSequence(organizationId: string) {
    logger.info(`Seeding record sequences for organization: ${organizationId}`)
    await this.db.insert(schema.RecordSequence).values(
      defaultRecordSequences.map((seq) => ({
        ...seq,
        organizationId,
        updatedAt: new Date(),
      }))
    )
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
   * and child tags, plus independent top-level tags — then the five AI mail
   * categories under their own parent (see `seedAiCategoryTags`).
   */
  private async seedTags(organizationId: string) {
    // Dedicated handler with `is_system_tag` bypass — the tag-system-guard
    // pre-hook drops any write of this flag unless the caller is in the
    // bypass set. Keeping the bypass scoped to this block (rather than the
    // whole seed run) documents the privilege boundary.
    const handler = new UnifiedCrudHandler(organizationId, this.userId, this.db, undefined, {
      bypassFieldGuards: new Set(['is_system_tag']),
    })

    // Skip snapshot invalidation and events during seeding — no active users to notify,
    // and each invalidation attempt costs 5s on Lambda when Redis is slow/unavailable
    const seedOpts = { skipEvents: true }

    // Create parent tag first - Topic Categorization
    // UnifiedCrudHandler.create() throws on error, so if we get a result, it succeeded
    const topicResult = await handler.create(
      'tag',
      {
        title: 'Topic Categorization',
        tag_description: 'Top-level categorization for support tickets',
        tag_emoji: '🏷️',
        tag_color: 'blue',
        is_system_tag: true,
      },
      seedOpts
    )

    // Create child tags under Topic Categorization using parent relationship
    // Must be sequential to avoid inverse relationship sync conflicts (sortKey collisions)
    //
    // `Billing` and `Sales` USED to live here as system tags, and `Support` below as an
    // independent one. They moved to `AI_CATEGORY_STARTER_TAGS` (mail-classification plan
    // §2.4), which needs those exact three titles — seeding both sets would give every new
    // org two tags called `Billing`, one of them frozen by the system-tag guard. They are
    // still created for every new org, just as ORDINARY tags under "Mail Categories", which
    // is what C4 requires: their descriptions are the classifier's instructions and have to
    // stay editable. `suggested:billing-mail` still resolves `Billing` by display name.
    const topicSubTags = [
      { title: 'Account Management', tag_emoji: '👤', tag_color: 'red' },
      { title: 'Customer Feedback', tag_emoji: '💬', tag_color: 'orange' },
      { title: 'Legal', tag_emoji: '⚖️', tag_color: 'gray' },
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
          is_system_tag: true,
        },
        seedOpts
      )
    }

    // Create independent tags (no parent) - can be parallel since no inverse sync needed
    // (`Support` moved to the AI mail categories — see the note on `topicSubTags`.)
    const independentTags = [
      { title: 'Urgent', tag_emoji: '🚨', tag_color: 'purple' },
      { title: 'Orders', tag_emoji: '📦', tag_color: 'amber' },
      { title: 'VIP', tag_emoji: '⭐', tag_color: 'orange' },
    ]

    await Promise.all(
      independentTags.map((tag) => handler.create('tag', { ...tag, is_system_tag: true }, seedOpts))
    )

    // The five AI mail categories, under their own parent. Ordinary (editable, deletable)
    // tags with `tag_ai_classify: true` — they make the labels AVAILABLE to the classifier
    // and nothing more; no mail is classified until an inbox is opted in.
    await seedAiCategoryTags(this.db, organizationId, this.userId)
  }
  // Create ticket sequence for the organization
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
    // No `defaultLens`: the org-shared default IS the absence of a
    // `role:org_member` baseline row (plan 40 §6 — `baselineAtCreate: false`
    // plus no row ⇒ the member's `Area.inboxes` level). Passing `'full'` was
    // the same statement written into `inbox_default_lens`, a field nothing has
    // read since phase 2; seeding the row would be strictly wrong here, because
    // "everyone at full" has no row form.
    const defaultInbox = await inboxService.createInbox({
      name: 'Shared Inbox',
      description: 'Default shared inbox for all team members',
      color: 'blue',
      status: 'ACTIVE',
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

    // Shopify App Store install path owns its own billing flow — the
    // finalizeAppStoreInstall mutation creates the Shopify-billing-provider
    // PlanSubscription row after the merchant picks a plan. Skipping here
    // keeps `organizationId` free of the auto-created Stripe trial row so the
    // claim flow can insert without a uniqueIndex collision.
    if (this.signupSource === 'shopify-claim') {
      logger.info('Shopify-claim signup, skipping trial subscription', { organizationId })
      return
    }

    // Startup program (marketing /startups → signup?ref=startup): land the org directly on the
    // Growth plan with Year-1 pricing (90% off) instead of a standard Growth trial. Auto-approve —
    // eligibility (≤$10M funding, <15 employees, new customer) is stated, not enforced.
    if (this.signupSource === 'startup') {
      await this.seedStartupSubscription(organizationId)
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
   * Create a Startup-program subscription (no Stripe, no trial): the org is placed on the
   * Growth plan with per-org custom pricing set to Year-1 (90% off the platform fee), and
   * `startupDiscountStartedAt` stamped so the discount window can be stepped down manually
   * (Year 2 → 50%, Year 3 → 25%) by a super-admin. Actual payment collection is handled
   * out-of-band like Enterprise custom pricing — no Stripe subscription is created here.
   * @param organizationId The organization ID
   */
  private async seedStartupSubscription(organizationId: string): Promise<void> {
    logger.info('Creating startup subscription for organization', { organizationId })

    try {
      // The Startup program reuses the Growth plan and discounts it.
      const [growthPlan] = await this.db
        .select({
          id: schema.Plan.id,
          monthlyPrice: schema.Plan.monthlyPrice,
          annualPrice: schema.Plan.annualPrice,
        })
        .from(schema.Plan)
        .where(eq(schema.Plan.name, 'Growth'))
        .limit(1)

      if (!growthPlan) {
        logger.warn('Growth plan not found, falling back to standard trial for startup signup', {
          organizationId,
        })
        return
      }

      // Year 1 = 90% off the platform fee (pay 10%). Year 2/3 stepped down manually.
      const STARTUP_YEAR_1_MULTIPLIER = 0.1
      const customPricingMonthly = Math.round(growthPlan.monthlyPrice * STARTUP_YEAR_1_MULTIPLIER)
      const customPricingAnnual = Math.round(growthPlan.annualPrice * STARTUP_YEAR_1_MULTIPLIER)

      await this.db.insert(schema.PlanSubscription).values({
        organizationId,
        planId: growthPlan.id,
        plan: 'Growth',
        status: 'active',
        billingCycle: 'MONTHLY',
        seats: 1,
        customPricingMonthly,
        customPricingAnnual,
        customPricingNotes: 'Startup program — Year 1 (90% off platform fee)',
        startupDiscountStartedAt: new Date(),
        updatedAt: new Date(),
      })

      logger.info('Successfully created startup subscription', {
        organizationId,
        customPricingMonthly,
        customPricingAnnual,
      })
    } catch (error: any) {
      logger.error('Failed to create startup subscription', {
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
      // Settings v2: no backfill needed — new catalog keys merge in as defaults
      // at read time for every org automatically.
      // The TOP-UP path for orgs created before doc 19 shipped: they have no
      // `PermissionProfile` rows at all, so every member would ride the
      // `ROLE_DEFAULTS` runtime fallback forever. Idempotent — new orgs already got
      // theirs inside the org-creation transaction.
      await ensureSystemProfiles(organizationId, this.db)
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
      // No `defaultLens` — see `seedInboxes`: "everyone at full" is the ABSENT
      // baseline row, not a row that says `full`.
      await inboxService.createInbox({
        name: 'Shared Inbox',
        description: 'Default shared inbox for all team members',
        color: 'blue',
        status: 'ACTIVE',
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
