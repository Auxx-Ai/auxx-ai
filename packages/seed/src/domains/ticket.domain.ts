// packages/seed/src/domains/ticket.domain.ts
// Ticket domain refinements for tickets and related entities with comprehensive seeding

import { createId } from '@paralleldrive/cuid2'
import { sql } from 'drizzle-orm'
import type { SeedingContext, SeedingScenario } from '../types'
import { BusinessDistributions } from '../utils/business-distributions'
import { ContentEngine } from '../generators/content-engine'

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
    context.auth.testUsers.forEach(user => userIds.add(user.id))
    context.auth.randomUsers.forEach(user => userIds.add(user.id))
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
   * insertDirectly performs direct database inserts bypassing drizzle-seed.
   * @param db - Drizzle database instance
   */
  async insertDirectly(db: any): Promise<void> {
    const { schema } = await import('@auxx/database')
    const organizationId = this.services.organizations[0]!.id

    // Seed tickets first
    await this.seedTickets(db, schema, organizationId)

    // Then seed related entities
    await this.seedTicketReplies(db, schema, organizationId)
    await this.seedTicketNotes(db, schema, organizationId)
    await this.seedTicketAssignments(db, schema, organizationId)
    await this.seedTicketRelations(db, schema, organizationId)
  }

  /**
   * seedTickets generates and inserts ticket records.
   * @param db - Drizzle database instance
   * @param schema - Database schema
   * @param organizationId - Organization ID to associate tickets with
   */
  private async seedTickets(db: any, schema: any, organizationId: string): Promise<void> {
    console.log('🎫 Generating tickets...')

    // Get existing contacts for linking
    const contacts = await db
      .select({ id: schema.Contact.id })
      .from(schema.Contact)
      .where(sql`${schema.Contact.organizationId} = ${organizationId}`)

    if (contacts.length === 0) {
      console.log('⚠️  No contacts found, skipping ticket generation')
      return
    }

    // Get existing orders for linking (optional)
    const orders = await db
      .select({ id: schema.Order.id })
      .from(schema.Order)
      .where(sql`${schema.Order.organizationId} = ${organizationId}`)
      .limit(100) // Only get recent orders

    const ticketCount = this.scenario.scales.tickets || 10
    const tickets = []

    for (let i = 0; i < ticketCount; i++) {
      const type = this.generateTicketType(i)
      const priority = this.generateTicketPriority(i)
      const status = this.generateTicketStatus(i)
      const createdAt = this.generateTicketCreatedAt(i, ticketCount)
      const timestamps = this.generateTicketTimestamps(status, createdAt)

      // Link to contact (round-robin)
      const contact = contacts[i % contacts.length]!

      // 40% of tickets are linked to orders (when orders exist)
      const orderId =
        orders.length > 0 && i % 10 < 4 ? orders[i % orders.length]!.id : null

      // 80% of tickets have a creator
      const createdById = i % 10 < 8 ? this.users[i % this.users.length]! : null

      tickets.push({
        id: createId(),
        number: this.generateTicketNumber(i),
        title: this.generateTicketTitle(type, i),
        description: this.generateTicketDescription(type, i),
        type,
        priority,
        status,
        createdAt,
        updatedAt: new Date(),
        dueDate: this.generateTicketDueDate(status, priority, createdAt),
        resolvedAt: timestamps.resolvedAt,
        closedAt: timestamps.closedAt,
        organizationId,
        contactId: contact.id,
        orderId,
        createdById,
        emailThreadId: null,
        mailgunMessageId: null,
        internalReference: null,
        shopifyCustomerId: null,
        typeData: this.generateTypeData(type),
        typeStatus: null,
      })
    }

    if (tickets.length > 0) {
      const BATCH_SIZE = 1000
      console.log(`📦 Inserting ${tickets.length} tickets...`)

      for (let i = 0; i < tickets.length; i += BATCH_SIZE) {
        const batch = tickets.slice(i, i + BATCH_SIZE)
        await db
          .insert(schema.Ticket)
          .values(batch)
          .onConflictDoUpdate({
            target: schema.Ticket.id,
            set: {
              title: sql`excluded.title`,
              status: sql`excluded.status`,
              updatedAt: sql`excluded."updatedAt"`,
            },
          })
      }

      console.log(`✅ Upserted ${tickets.length} tickets`)
    }
  }

  /**
   * seedTicketReplies generates and inserts ticket reply records.
   * @param db - Drizzle database instance
   * @param schema - Database schema
   * @param organizationId - Organization ID to filter tickets
   */
  private async seedTicketReplies(db: any, schema: any, organizationId: string): Promise<void> {
    console.log('💬 Generating ticket replies...')

    // Get existing tickets
    const tickets = await db
      .select({
        id: schema.Ticket.id,
        type: schema.Ticket.type,
        contactId: schema.Ticket.contactId,
      })
      .from(schema.Ticket)
      .where(sql`${schema.Ticket.organizationId} = ${organizationId}`)

    if (tickets.length === 0) {
      console.log('⚠️  No tickets found, skipping reply generation')
      return
    }

    const replies = []

    tickets.forEach((ticket: any, ticketIndex: number) => {
      // Generate 1-5 replies per ticket
      const replyCount = 1 + (ticketIndex % 5)

      for (let i = 0; i < replyCount; i++) {
        const isFromCustomer = i % 2 === 0 // Alternate customer/agent
        const sentTime = new Date(Date.now() - (replyCount - i) * 7200000) // 2 hours apart

        replies.push({
          id: createId(),
          content: this.generateReplyContent(ticket.type, i, isFromCustomer),
          createdAt: sentTime,
          messageId: null,
          senderEmail: null,
          isFromCustomer,
          ticketId: ticket.id,
          recipientEmail: null,
          ccEmails: [],
          createdById: isFromCustomer
            ? null
            : this.users[ticketIndex % this.users.length]!,
          mailgunMessageId: null,
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

  /**
   * seedTicketNotes generates and inserts ticket note records.
   * @param db - Drizzle database instance
   * @param schema - Database schema
   * @param organizationId - Organization ID to filter tickets
   */
  private async seedTicketNotes(db: any, schema: any, organizationId: string): Promise<void> {
    console.log('📝 Generating ticket notes...')

    const tickets = await db
      .select({ id: schema.Ticket.id })
      .from(schema.Ticket)
      .where(sql`${schema.Ticket.organizationId} = ${organizationId}`)

    if (tickets.length === 0) {
      console.log('⚠️  No tickets found, skipping note generation')
      return
    }

    const notes = []

    tickets.forEach((ticket: any, ticketIndex: number) => {
      // 60% of tickets have notes, 0-3 notes per ticket
      if (ticketIndex % 10 < 6) {
        const noteCount = 1 + (ticketIndex % 3)

        for (let i = 0; i < noteCount; i++) {
          notes.push({
            id: createId(),
            ticketId: ticket.id,
            content: this.generateNoteContent(i),
            authorId: this.users[ticketIndex % this.users.length]!,
            isInternal: true,
            createdAt: new Date(Date.now() - (noteCount - i) * 14400000), // 4 hours apart
            updatedAt: new Date(),
          })
        }
      }
    })

    if (notes.length > 0) {
      const BATCH_SIZE = 2000
      console.log(`📦 Inserting ${notes.length} ticket notes...`)

      for (let i = 0; i < notes.length; i += BATCH_SIZE) {
        const batch = notes.slice(i, i + BATCH_SIZE)
        await db
          .insert(schema.TicketNote)
          .values(batch)
          .onConflictDoUpdate({
            target: schema.TicketNote.id,
            set: {
              content: sql`excluded.content`,
              updatedAt: sql`excluded."updatedAt"`,
            },
          })
      }

      console.log(`✅ Upserted ${notes.length} ticket notes`)
    }
  }

  /**
   * seedTicketAssignments generates and inserts ticket assignment records.
   * @param db - Drizzle database instance
   * @param schema - Database schema
   * @param organizationId - Organization ID to filter tickets
   */
  private async seedTicketAssignments(
    db: any,
    schema: any,
    organizationId: string
  ): Promise<void> {
    console.log('👤 Generating ticket assignments...')

    const tickets = await db
      .select({ id: schema.Ticket.id })
      .from(schema.Ticket)
      .where(sql`${schema.Ticket.organizationId} = ${organizationId}`)

    if (tickets.length === 0) {
      console.log('⚠️  No tickets found, skipping assignment generation')
      return
    }

    const assignments = []

    tickets.forEach((ticket: any, ticketIndex: number) => {
      // 80% of tickets are assigned
      if (ticketIndex % 10 < 8) {
        const agent = this.users[ticketIndex % this.users.length]!

        // Create active assignment
        assignments.push({
          id: createId(),
          ticketId: ticket.id,
          agentId: agent,
          isActive: true,
          assignedAt: new Date(Date.now() - 3600000), // 1 hour ago
          updatedAt: new Date(),
        })

        // 20% of tickets have a reassignment history (inactive assignment)
        if (ticketIndex % 10 < 2 && this.users.length > 1) {
          const previousAgent = this.users[(ticketIndex + 1) % this.users.length]!
          assignments.push({
            id: createId(),
            ticketId: ticket.id,
            agentId: previousAgent,
            isActive: false,
            assignedAt: new Date(Date.now() - 86400000), // 24 hours ago
            updatedAt: new Date(Date.now() - 3600000), // Deactivated 1 hour ago
          })
        }
      }
    })

    if (assignments.length > 0) {
      const BATCH_SIZE = 2000
      console.log(`📦 Inserting ${assignments.length} ticket assignments...`)

      for (let i = 0; i < assignments.length; i += BATCH_SIZE) {
        const batch = assignments.slice(i, i + BATCH_SIZE)
        await db
          .insert(schema.TicketAssignment)
          .values(batch)
          .onConflictDoUpdate({
            target: [
              schema.TicketAssignment.ticketId,
              schema.TicketAssignment.agentId,
              schema.TicketAssignment.isActive,
            ],
            set: {
              updatedAt: sql`excluded."updatedAt"`,
            },
          })
      }

      console.log(`✅ Upserted ${assignments.length} ticket assignments`)
    }
  }

  /**
   * seedTicketRelations generates and inserts ticket relation records.
   * @param db - Drizzle database instance
   * @param schema - Database schema
   * @param organizationId - Organization ID to filter tickets
   */
  private async seedTicketRelations(
    db: any,
    schema: any,
    organizationId: string
  ): Promise<void> {
    console.log('🔗 Generating ticket relations...')

    const tickets = await db
      .select({ id: schema.Ticket.id })
      .from(schema.Ticket)
      .where(sql`${schema.Ticket.organizationId} = ${organizationId}`)

    if (tickets.length < 2) {
      console.log('⚠️  Need at least 2 tickets for relations, skipping')
      return
    }

    const relations = []
    const relationTypes = ['DUPLICATE', 'RELATED', 'BLOCKS', 'BLOCKED_BY']

    // Create relations for ~30% of tickets
    tickets.forEach((ticket: any, ticketIndex: number) => {
      if (ticketIndex % 10 < 3 && ticketIndex > 0) {
        // Link to a previous ticket
        const relatedTicket = tickets[ticketIndex - 1]!
        const relationType = relationTypes[ticketIndex % relationTypes.length]!

        relations.push({
          id: createId(),
          ticketId: ticket.id,
          relatedTicketId: relatedTicket.id,
          relation: relationType,
          createdAt: new Date(),
        })

        // For BLOCKS/BLOCKED_BY, create bidirectional relationship
        if (relationType === 'BLOCKS') {
          relations.push({
            id: createId(),
            ticketId: relatedTicket.id,
            relatedTicketId: ticket.id,
            relation: 'BLOCKED_BY',
            createdAt: new Date(),
          })
        }
      }
    })

    if (relations.length > 0) {
      const BATCH_SIZE = 2000
      console.log(`📦 Inserting ${relations.length} ticket relations...`)

      for (let i = 0; i < relations.length; i += BATCH_SIZE) {
        const batch = relations.slice(i, i + BATCH_SIZE)
        await db
          .insert(schema.TicketRelation)
          .values(batch)
          .onConflictDoNothing() // Unique constraint handles duplicates
      }

      console.log(`✅ Upserted ${relations.length} ticket relations`)
    }
  }

  // ---- Generator Methods ----

  /** generateTicketNumber creates formatted ticket numbers. */
  private generateTicketNumber(index: number): string {
    return `TKT-${String(index + 1).padStart(4, '0')}`
  }

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

  /** generateTicketTimestamps creates status-appropriate timestamps. */
  private generateTicketTimestamps(
    status: string,
    createdAt: Date
  ): {
    resolvedAt: Date | null
    closedAt: Date | null
  } {
    const baseTime = createdAt.getTime()

    if (status === 'RESOLVED') {
      return {
        resolvedAt: new Date(baseTime + 172800000), // 2 days later
        closedAt: null,
      }
    }

    if (status === 'CLOSED') {
      return {
        resolvedAt: new Date(baseTime + 172800000), // 2 days later
        closedAt: new Date(baseTime + 259200000), // 3 days later
      }
    }

    return { resolvedAt: null, closedAt: null }
  }

  /** generateTicketDueDate creates priority-based due dates. */
  private generateTicketDueDate(
    status: string,
    priority: string,
    createdAt: Date
  ): Date | null {
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
      TECHNICAL: [
        'Technical issue with platform',
        'Login problems',
        'Website functionality issue',
      ],
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
        "This item is not what I ordered. I need to initiate a return.",
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

  /** generateTypeData creates type-specific metadata. */
  private generateTypeData(type: string): Record<string, unknown> {
    switch (type) {
      case 'MISSING_ITEM':
        return { missingItems: ['Product A', 'Product B'] }
      case 'RETURN':
        return { returnReason: 'Not as expected', refundMethod: 'original_payment' }
      case 'REFUND':
        return { refundAmount: 99.99, refundMethod: 'credit_card' }
      case 'SHIPPING_ISSUE':
        return { expectedDelivery: new Date(), actualDelivery: null }
      default:
        return {}
    }
  }

  /** generateReplyContent creates realistic reply content. */
  private generateReplyContent(type: string, index: number, isFromCustomer: boolean): string {
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

  /** generateNoteContent creates realistic internal note content. */
  private generateNoteContent(index: number): string {
    return [
      'Customer called for follow-up. Left voicemail.',
      'Reviewed order history. Customer is a repeat purchaser.',
      'Escalated to manager for approval.',
      'Waiting for warehouse confirmation.',
      'Refund approved and processed.',
    ][index % 5]!
  }
}