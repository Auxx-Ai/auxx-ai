// packages/seed/src/domains/ticket.domain.ts
// Ticket domain refinements via UnifiedCrudHandler

import { createId } from '@paralleldrive/cuid2'
import { sql } from 'drizzle-orm'
import { ContentEngine } from '../generators/content-engine'
import type { SeedingContext, SeedingScenario } from '../types'
import { BusinessDistributions } from '../utils/business-distributions'

/** TicketDomain encapsulates ticket and related entity refinements. */
export class TicketDomain {
  /** scenario stores the resolved scenario definition. */
  private readonly scenario: SeedingScenario
  /** distributions provides realistic business data patterns. */
  private readonly distributions: BusinessDistributions
  /** content generates realistic business content. */
  private readonly content: ContentEngine
  /** context stores the seeding context with foreign key references. */
  private readonly context: SeedingContext
  /** organizationId targets seeding to a specific organization. */
  private readonly organizationId?: string

  /** services caches organization-level references for building relationships. */
  private readonly services: {
    organizations: Array<{ id: string; ownerId: string }>
  }
  /** users caches seeded user identifiers for assignee/author selection. */
  private readonly users: string[]

  /**
   * Creates a new TicketDomain instance.
   * @param scenario - Scenario definition to align entity counts with.
   * @param context - Cross-domain seeding context with foreign key references.
   * @param options - Optional configuration for organization-scoped seeding.
   */
  constructor(
    scenario: SeedingScenario,
    context: SeedingContext,
    options?: { organizationId?: string }
  ) {
    this.scenario = scenario
    this.distributions = new BusinessDistributions(scenario.dataQuality)
    this.content = new ContentEngine(scenario.dataQuality)
    this.context = context
    this.organizationId = options?.organizationId

    // Filter organizations by organizationId if specified
    const filteredOrgs = this.organizationId
      ? context.services.organizations.filter((o) => o.id === this.organizationId)
      : context.services.organizations

    this.services = {
      organizations: filteredOrgs,
    }

    if (this.services.organizations.length === 0) {
      throw new Error(
        `TicketDomain requires at least one organization${
          this.organizationId ? ` for organization ${this.organizationId}` : ''
        } in the seeding context`
      )
    }

    // Collect all user IDs from context
    const userIds = new Set<string>()
    context.auth.testUsers.forEach((user) => userIds.add(user.id))
    context.auth.randomUsers.forEach((user) => userIds.add(user.id))
    this.users = Array.from(userIds)

    if (this.users.length === 0) {
      throw new Error('TicketDomain requires at least one seeded user')
    }

    console.log('🎫 TicketDomain context', {
      tickets: this.scenario.scales.tickets,
      organizations: this.services.organizations.length,
      users: this.users.length,
    })
  }

  /**
   * insertDirectly creates tickets via UnifiedCrudHandler and replies via direct inserts.
   * @param db - Drizzle database instance
   */
  async insertDirectly(db: any): Promise<void> {
    const { schema } = await import('@auxx/database')
    const { UnifiedCrudHandler } = await import('@auxx/lib/resources')
    const organizationId = this.services.organizations[0]!.id
    const userId = this.services.organizations[0]!.ownerId

    // Seed tickets via UnifiedCrudHandler
    await this.seedTickets(db, schema, organizationId, userId, UnifiedCrudHandler)

    // Seed ticket replies (TicketReply stays as its own table)
    await this.seedTicketReplies(db, schema, organizationId)
  }

  /**
   * seedTickets generates and creates ticket records via UnifiedCrudHandler.
   * @param db - Drizzle database instance
   * @param schema - Database schema
   * @param organizationId - Organization ID to associate tickets with
   * @param userId - User ID for the handler
   * @param UnifiedCrudHandler - The handler class
   */
  private async seedTickets(
    db: any,
    schema: any,
    organizationId: string,
    userId: string,
    UnifiedCrudHandler: any
  ): Promise<void> {
    console.log('🎫 Generating tickets via UnifiedCrudHandler...')

    const handler = new UnifiedCrudHandler(organizationId, userId, db)

    // Get existing contact EntityInstances for linking
    const contacts = await db
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .innerJoin(
        schema.EntityDefinition,
        sql`${schema.EntityInstance.entityDefinitionId} = ${schema.EntityDefinition.id}`
      )
      .where(
        sql`${schema.EntityDefinition.entityType} = 'contact' AND ${schema.EntityInstance.organizationId} = ${organizationId}`
      )

    if (contacts.length === 0) {
      console.log('⚠️  No contacts found, skipping ticket generation')
      return
    }

    const ticketCount = this.scenario.scales.tickets || 10
    const ticketValues = []

    for (let i = 0; i < ticketCount; i++) {
      const type = this.generateTicketType(i)
      const priority = this.generateTicketPriority(i)
      const status = this.generateTicketStatus(i)
      const createdAt = this.generateTicketCreatedAt(i, ticketCount)

      // Link to contact (round-robin)
      const contact = contacts[i % contacts.length]!

      // 80% of tickets have an assignee
      const assigneeId = i % 10 < 8 ? this.users[i % this.users.length]! : undefined

      ticketValues.push({
        ticket_title: this.generateTicketTitle(type, i),
        ticket_description: this.generateTicketDescription(type, i),
        ticket_type: type,
        ticket_status: status,
        ticket_priority: priority,
        ticket_contact: contact.id,
        ...(assigneeId ? { assigned_to_id: assigneeId } : {}),
        due_date: this.generateTicketDueDate(status, priority, createdAt),
      })
    }

    if (ticketValues.length > 0) {
      const { created, errors } = await handler.bulkCreate('ticket', ticketValues, {
        skipEvents: true,
      })

      if (errors.length > 0) {
        console.log(`⚠️  ${errors.length} ticket creation errors:`)
        errors.slice(0, 5).forEach((e: any) => console.log(`    [${e.index}] ${e.error}`))
      }

      console.log(`✅ Created ${created.length} tickets via UnifiedCrudHandler`)
    }
  }

  /**
   * seedTicketReplies generates and inserts ticket reply records.
   * Uses EntityInstance IDs from ticket entities.
   * @param db - Drizzle database instance
   * @param schema - Database schema
   * @param organizationId - Organization ID to filter tickets
   */
  private async seedTicketReplies(db: any, schema: any, organizationId: string): Promise<void> {
    console.log('💬 Generating ticket replies...')

    // Get ticket EntityInstances
    const tickets = await db
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .innerJoin(
        schema.EntityDefinition,
        sql`${schema.EntityInstance.entityDefinitionId} = ${schema.EntityDefinition.id}`
      )
      .where(
        sql`${schema.EntityDefinition.entityType} = 'ticket' AND ${schema.EntityInstance.organizationId} = ${organizationId}`
      )

    if (tickets.length === 0) {
      console.log('⚠️  No tickets found, skipping reply generation')
      return
    }

    const replies: any[] = []

    tickets.forEach((ticket: any, ticketIndex: number) => {
      // Generate 1-5 replies per ticket
      const replyCount = 1 + (ticketIndex % 5)

      for (let i = 0; i < replyCount; i++) {
        const isFromCustomer = i % 2 === 0 // Alternate customer/agent
        const sentTime = new Date(Date.now() - (replyCount - i) * 7200000) // 2 hours apart

        replies.push({
          id: createId(),
          content: this.generateReplyContent(i, isFromCustomer),
          createdAt: sentTime,
          messageId: null,
          senderEmail: null,
          isFromCustomer,
          entityInstanceId: ticket.id,
          organizationId: organizationId,
          recipientEmail: null,
          ccEmails: [],
          createdById: isFromCustomer ? null : this.users[ticketIndex % this.users.length]!,
          inReplyTo: null,
          references: null,
        })
      }
    })

    if (replies.length > 0) {
      const BATCH_SIZE = 2000
      console.log(`📦 Inserting ${replies.length} ticket replies...`)

      for (let i = 0; i < replies.length; i += BATCH_SIZE) {
        const batch = replies.slice(i, i + BATCH_SIZE)
        await db
          .insert(schema.TicketReply)
          .values(batch)
          .onConflictDoUpdate({
            target: schema.TicketReply.id,
            set: {
              content: sql`excluded.content`,
            },
          })
      }

      console.log(`✅ Upserted ${replies.length} ticket replies`)
    }
  }

  // ---- Generator Methods ----

  /** generateTicketType creates realistic ticket type distribution. */
  private generateTicketType(index: number): string {
    const types = [
      'GENERAL',
      'GENERAL',
      'GENERAL', // 30%
      'MISSING_ITEM',
      'MISSING_ITEM', // 15%
      'RETURN',
      'RETURN', // 15%
      'REFUND',
      'PRODUCT_ISSUE',
      'SHIPPING_ISSUE',
      'BILLING',
      'TECHNICAL',
    ]
    return types[index % types.length]!
  }

  /** generateTicketPriority creates realistic priority distribution. */
  private generateTicketPriority(index: number): string {
    const priorities = this.distributions.getSupportTicketPriorities()
    const selected = this.distributions.selectWeightedValue(priorities, index)
    return selected.toUpperCase()
  }

  /** generateTicketStatus creates realistic status distribution. */
  private generateTicketStatus(index: number): string {
    const statuses = [
      'OPEN',
      'OPEN', // 20%
      'IN_PROGRESS',
      'IN_PROGRESS', // 15%
      'WAITING_FOR_CUSTOMER', // 10%
      'WAITING_FOR_THIRD_PARTY', // 5%
      'RESOLVED',
      'RESOLVED',
      'RESOLVED', // 25%
      'CLOSED',
      'CLOSED', // 20%
      'CANCELLED',
      'MERGED',
    ]
    return statuses[index % statuses.length]!
  }

  /** generateTicketCreatedAt creates staggered creation timestamps. */
  private generateTicketCreatedAt(index: number, total: number): Date {
    const daysAgo = Math.floor((total - index) / 2) // Spread over time
    return new Date(Date.now() - daysAgo * 86400000)
  }

  /** generateTicketDueDate creates priority-based due dates. */
  private generateTicketDueDate(status: string, priority: string, createdAt: Date): Date | null {
    // Open/In Progress tickets have due dates
    if (!['OPEN', 'IN_PROGRESS'].includes(status)) {
      return null
    }

    const baseTime = createdAt.getTime()
    const urgencyHours = {
      URGENT: 4,
      HIGH: 24,
      MEDIUM: 72,
      LOW: 168,
    }

    const hours = urgencyHours[priority as keyof typeof urgencyHours] || 72
    return new Date(baseTime + hours * 3600000)
  }

  /** generateTicketTitle creates type-appropriate titles. */
  private generateTicketTitle(type: string, index: number): string {
    const titles: Record<string, string[]> = {
      GENERAL: [
        'General inquiry about services',
        'Question about account features',
        'Request for information',
      ],
      MISSING_ITEM: [
        'Missing item from order',
        'Incomplete order received',
        'Package missing items',
      ],
      RETURN: [
        'Return request for recent order',
        'Product return authorization needed',
        'Initiate product return',
      ],
      REFUND: [
        'Refund request for canceled order',
        'Request refund for defective product',
        'Refund processing inquiry',
      ],
      PRODUCT_ISSUE: [
        'Product not working as expected',
        'Defective product received',
        'Quality issue with product',
      ],
      SHIPPING_ISSUE: [
        'Delayed shipment inquiry',
        'Package tracking issue',
        'Wrong shipping address',
      ],
      BILLING: [
        'Billing discrepancy on invoice',
        'Payment processing issue',
        'Incorrect charge on account',
      ],
      TECHNICAL: ['Technical issue with platform', 'Login problems', 'Website functionality issue'],
    }

    const typeTemplates = titles[type] || titles.GENERAL
    return typeTemplates[index % typeTemplates.length]!
  }

  /** generateTicketDescription creates type-appropriate descriptions. */
  private generateTicketDescription(type: string, index: number): string {
    const descriptions: Record<string, string[]> = {
      GENERAL: [
        'I have a general question about your services and would like to get more information.',
        'Could you please provide details about the available options?',
        'I need assistance understanding how this works.',
      ],
      MISSING_ITEM: [
        'My order arrived today but several items are missing from the package. Order number is included.',
        "The package I received is incomplete. I'm missing some products that were listed in my order.",
        'I only received part of my order. Can you help me locate the missing items?',
      ],
      RETURN: [
        "I would like to return this product as it doesn't meet my expectations. Please provide return instructions.",
        'This item is not what I ordered. I need to initiate a return.',
        'I need to return this product. What is your return policy?',
      ],
      REFUND: [
        'I returned my order and would like to follow up on the refund status.',
        'I was charged incorrectly and need a refund processed.',
        "I cancelled my order but haven't received my refund yet.",
      ],
      PRODUCT_ISSUE: [
        'The product I received is defective and not functioning properly.',
        "There is a quality issue with the item I purchased. It doesn't work as described.",
        'The product arrived damaged and unusable.',
      ],
      SHIPPING_ISSUE: [
        "My order was supposed to arrive yesterday but the tracking shows it's still in transit.",
        "The tracking number isn't working and I can't locate my package.",
        'My package was delivered to the wrong address.',
      ],
      BILLING: [
        'I noticed an incorrect charge on my account that needs to be investigated.',
        "My payment didn't process correctly and I was charged twice.",
        'There is a discrepancy between my invoice and what I was charged.',
      ],
      TECHNICAL: [
        "I'm experiencing technical difficulties accessing my account.",
        "The website isn't loading properly and I can't complete my order.",
        "I'm getting error messages when trying to use certain features.",
      ],
    }

    const typeTemplates = descriptions[type] || descriptions.GENERAL
    return typeTemplates[index % typeTemplates.length]!
  }

  /** generateReplyContent creates realistic reply content. */
  private generateReplyContent(index: number, isFromCustomer: boolean): string {
    if (isFromCustomer) {
      return [
        'Hello, I need help with my recent order.',
        'Thank you for your response. I have some additional questions.',
        'I appreciate your help with this matter.',
        'Could you provide an update on the status?',
        "I'm still waiting for a resolution.",
      ][index % 5]!
    } else {
      return [
        "Thank you for contacting us. We're looking into your request.",
        "I've reviewed your case and here's what we can do to help.",
        'We apologize for the inconvenience. Let me assist you with this.',
        "I've processed your request and you should see changes shortly.",
        'Is there anything else I can help you with today?',
      ][index % 5]!
    }
  }
}
