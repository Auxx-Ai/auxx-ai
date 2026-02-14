// packages/seed/src/domains/communication.domain.ts
// Communication domain refinements for support threads and messages with comprehensive seeding

import { createId } from '@paralleldrive/cuid2'
import { and, eq, sql } from 'drizzle-orm'
import { ContentEngine } from '../generators/content-engine'
import type {
  SeedingContext,
  SeedingScenario,
  ServiceIntegratorInbox,
  ServiceIntegratorIntegration,
} from '../types'
import { BusinessDistributions } from '../utils/business-distributions'
import { RelationshipEngine } from '../utils/relationship-engine'

/** CommunicationDomain encapsulates support thread and message refinements. */
export class CommunicationDomain {
  /** scenario stores the resolved scenario definition. */
  private readonly scenario: SeedingScenario
  /** distributions provides realistic business data patterns. */
  private readonly distributions: BusinessDistributions
  /** relationships builds entity connections. */
  private readonly relationships: RelationshipEngine
  /** content generates realistic business content. */
  private readonly content: ContentEngine
  /** organizationId targets seeding to a specific organization. */
  private readonly organizationId?: string
  /** threadParticipants caches generated participant arrays. */
  private threadParticipants?: string[][]
  /** threadCreatedAt caches generated creation timestamps. */
  private threadCreatedAt?: Date[]
  /** threadFirstMessageAt caches first message timestamps. */
  private threadFirstMessageAt?: Date[]
  /** threadLastMessageAt caches last message timestamps. */
  private threadLastMessageAt?: Date[]
  /** threadMetadataCache caches metadata payloads. */
  private threadMetadataCache?: Record<string, unknown>[]

  /** services caches organization-level references for building relationships. */
  private readonly services: {
    organizations: Array<{ id: string; ownerId: string }>
    integrations: ServiceIntegratorIntegration[]
    inboxes: ServiceIntegratorInbox[]
  }
  /** users caches seeded user identifiers for assignee/participant selection. */
  private readonly users: string[]

  /**
   * Creates a new CommunicationDomain instance.
   * @param scenario - Scenario definition used to scale entities.
   * @param context - Seeding context with auth/service references.
   * @param options - Optional configuration for organization-scoped seeding.
   */
  constructor(
    scenario: SeedingScenario,
    context: SeedingContext,
    options?: { organizationId?: string }
  ) {
    this.scenario = scenario
    this.distributions = new BusinessDistributions(scenario.dataQuality)
    this.relationships = new RelationshipEngine(scenario)
    this.content = new ContentEngine(scenario.dataQuality)
    this.organizationId = options?.organizationId

    // Filter by organizationId if specified
    const filteredOrgs = this.organizationId
      ? context.services.organizations.filter((o) => o.id === this.organizationId)
      : context.services.organizations

    const filteredIntegrations = this.organizationId
      ? context.services.integrations.filter((i) => i.organizationId === this.organizationId)
      : context.services.integrations

    const filteredInboxes = this.organizationId
      ? context.services.inboxes.filter((i) => i.organizationId === this.organizationId)
      : context.services.inboxes

    this.services = {
      organizations: filteredOrgs,
      integrations: filteredIntegrations,
      inboxes: filteredInboxes,
    }
    if (!this.services.integrations || this.services.integrations.length === 0) {
      throw new Error(
        `CommunicationDomain requires at least one integration${
          this.organizationId ? ` for organization ${this.organizationId}` : ''
        } from the seeding context`
      )
    }
    const userIds = new Set<string>()
    context.auth.testUsers.forEach((user) => userIds.add(user.id))
    context.auth.randomUsers.forEach((user) => userIds.add(user.id))
    this.users = Array.from(userIds)
    if (this.users.length === 0) {
      throw new Error('CommunicationDomain requires at least one seeded user to assign threads')
    }
    console.log('💬 CommunicationDomain context', {
      threads: this.scenario.scales.threads,
      organizations: this.services.organizations.length,
      integrations: this.services.integrations.length,
      inboxes: this.services.inboxes.length,
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

    // Create support participants FIRST (before threads)
    await this.seedSupportParticipants(db, schema, organizationId)

    // Get all participants (customer + support) for thread creation
    const allParticipants = await db
      .select({
        id: schema.Participant.id,
        contactId: schema.Participant.contactId,
        identifier: schema.Participant.identifier,
      })
      .from(schema.Participant)
      .where(sql`${schema.Participant.organizationId} = ${organizationId}`)

    const customerParticipants = allParticipants.filter((p: any) => p.contactId !== null)
    const supportParticipants = allParticipants.filter((p: any) => p.contactId === null)

    console.log(
      `  📊 Participants: ${customerParticipants.length} customers, ${supportParticipants.length} support agents`
    )

    // Generate thread data
    console.log('💬 Generating thread data...')
    const ids = this.generateThreadIds()
    const subjects = this.generateThreadSubjects()
    const organizationIds = this.generateThreadOrganizationIds()
    const integrationIds = this.generateThreadIntegrationIds()
    const messageTypes = this.generateMessageTypes()
    const integrationTypes = this.generateIntegrationTypes()
    const assigneeIds = this.generateThreadAssigneeIds()
    const types = this.generateThreadTypes()
    const statuses = this.generateThreadStatuses()
    const messageCounts = this.generateMessageCounts()
    const createdAt = this.generateThreadCreatedAt()
    const firstMessageAt = this.generateThreadFirstMessageAt()
    const lastMessageAt = this.generateThreadLastMessageAt()
    const inboxIds = this.generateThreadInboxIds()
    const metadata = this.generateThreadMetadata()

    // Insert threads with REAL participant IDs
    const threadRows = []
    for (let i = 0; i < this.scenario.scales.threads; i++) {
      // Assign 1 customer + 1 support agent to each thread
      const customerParticipant = customerParticipants[i % customerParticipants.length]
      const supportParticipant = supportParticipants[i % supportParticipants.length]

      threadRows.push({
        id: ids[i],
        subject: subjects[i],
        participantIds:
          customerParticipant && supportParticipant
            ? [customerParticipant.id, supportParticipant.id]
            : [],
        organizationId: organizationIds[i],
        integrationId: integrationIds[i],
        messageType: messageTypes[i],
        integrationType: integrationTypes[i],
        assigneeId: assigneeIds[i],
        type: types[i],
        status: statuses[i],
        messageCount: messageCounts[i],
        participantCount: 2, // Always 2: customer + support
        createdAt: createdAt[i],
        firstMessageAt: firstMessageAt[i],
        lastMessageAt: lastMessageAt[i],
        inboxId: inboxIds[i],
        metadata: metadata[i],
      })
    }

    if (threadRows.length > 0) {
      console.log('📝 Thread rows to insert:')
      threadRows.forEach((row, i) => {
        console.log(
          `  [${i}] id=${row.id}, subject="${row.subject?.substring(0, 50)}...", status=${row.status}`
        )
      })

      await db
        .insert(schema.Thread)
        .values(threadRows)
        .onConflictDoUpdate({
          target: schema.Thread.id,
          set: {
            subject: sql`excluded.subject`,
            status: sql`excluded.status`,
            messageCount: sql`excluded."messageCount"`,
            participantIds: sql`excluded."participantIds"`,
            updatedAt: sql`excluded."updatedAt"`,
          },
        })
      console.log(`✅ Upserted ${threadRows.length} threads`)
    }

    // Generate and insert Messages (now with proper participant relationships)
    await this.seedMessages(db, schema, organizationId)

    // Generate and insert thread tag associations (via FieldValue)
    await this.seedThreadTags(db, schema, organizationId)
  }

  /**
   * seedSupportParticipants creates participant records for support users.
   * @param db - Drizzle database instance
   * @param schema - Database schema
   * @param organizationId - Organization ID
   */
  private async seedSupportParticipants(
    db: any,
    schema: any,
    organizationId: string
  ): Promise<void> {
    console.log('👤 Creating support participants...')

    const { schema: dbSchema } = await import('@auxx/database')

    // Get user emails and names
    const users = await db
      .select({ id: dbSchema.User.id, email: dbSchema.User.email, name: dbSchema.User.name })
      .from(dbSchema.User)
      .where(
        sql`${dbSchema.User.id} = ANY(${sql.raw(`ARRAY[${this.users.map((id) => `'${id}'`).join(',')}]`)})`
      )

    const supportParticipants = []

    users.forEach((user: any) => {
      supportParticipants.push({
        id: createId(),
        identifier: user.email,
        identifierType: 'EMAIL',
        name: user.name, // Use actual user name
        organizationId: organizationId,
        contactId: null, // Support users don't have contacts
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    })

    if (supportParticipants.length > 0) {
      await db
        .insert(schema.Participant)
        .values(supportParticipants)
        .onConflictDoUpdate({
          target: [
            schema.Participant.organizationId,
            schema.Participant.identifier,
            schema.Participant.identifierType,
          ],
          set: {
            name: sql`excluded.name`,
            updatedAt: sql`excluded."updatedAt"`,
          },
        })

      console.log(`✅ Upserted ${supportParticipants.length} support participants`)
    }
  }

  /**
   * seedThreadTags generates and inserts thread tag associations via FieldValue.
   * Uses the thread_tags RELATIONSHIP field to store tag assignments.
   * @param db - Drizzle database instance
   * @param schema - Database schema
   * @param organizationId - Organization ID to filter threads and tags
   */
  private async seedThreadTags(db: any, schema: any, organizationId: string): Promise<void> {
    console.log('🏷️  Generating tag-thread associations...')

    // Find the thread_tags custom field
    const threadTagsField = await db
      .select({ id: schema.CustomField.id })
      .from(schema.CustomField)
      .innerJoin(
        schema.EntityDefinition,
        eq(schema.CustomField.entityDefinitionId, schema.EntityDefinition.id)
      )
      .where(
        and(
          eq(schema.CustomField.systemAttribute, 'thread_tags'),
          eq(schema.EntityDefinition.organizationId, organizationId)
        )
      )
      .limit(1)

    if (threadTagsField.length === 0) {
      console.log('⚠️  thread_tags field not found, skipping tag associations')
      return
    }

    const fieldId = threadTagsField[0]!.id

    // Get existing threads
    const threads = await db
      .select({ id: schema.Thread.id })
      .from(schema.Thread)
      .where(sql`${schema.Thread.organizationId} = ${organizationId}`)

    if (threads.length === 0) {
      console.log('⚠️  No threads found, skipping tag associations')
      return
    }

    // Get existing tags
    const tags = await db
      .select({ id: schema.Tag.id })
      .from(schema.Tag)
      .where(sql`${schema.Tag.organizationId} = ${organizationId}`)

    if (tags.length === 0) {
      console.log('⚠️  No tags found, skipping tag associations')
      return
    }

    const fieldValues: Array<{
      id: string
      fieldId: string
      entityId: string
      relatedEntityId: string
      createdAt: Date
      updatedAt: Date
    }> = []

    threads.forEach((thread: any, threadIndex: number) => {
      // Add 1-3 tags per thread
      const tagCount = 1 + (threadIndex % 3)

      for (let i = 0; i < tagCount; i++) {
        const tag = tags[(threadIndex + i) % tags.length]!

        fieldValues.push({
          id: `fv_${createId()}`,
          fieldId,
          entityId: thread.id,
          relatedEntityId: tag.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }
    })

    if (fieldValues.length > 0) {
      await db.insert(schema.FieldValue).values(fieldValues).onConflictDoNothing()

      console.log(`✅ Upserted ${fieldValues.length} tag-thread associations via FieldValue`)
    }
  }

  /**
   * seedMessages generates and inserts message records for threads.
   * @param db - Drizzle database instance
   * @param schema - Database schema
   * @param organizationId - Organization ID to filter threads
   */
  private async seedMessages(db: any, schema: any, organizationId: string): Promise<void> {
    console.log('✉️  Generating messages for threads...')

    const { schema: dbSchema } = await import('@auxx/database')

    // Get existing threads with participantIds
    const threads = await db
      .select()
      .from(schema.Thread)
      .where(sql`${schema.Thread.organizationId} = ${organizationId}`)

    if (threads.length === 0) {
      console.log('⚠️  No threads found, skipping message generation')
      return
    }

    // Get all participants with contact info
    const participants = await db
      .select()
      .from(schema.Participant)
      .where(sql`${schema.Participant.organizationId} = ${organizationId}`)

    if (participants.length === 0) {
      console.log('⚠️  No participants found, skipping message generation')
      return
    }

    // Create participant lookup map
    const participantMap = new Map(participants.map((p: any) => [p.id, p]))

    // Get users for createdById
    const users = await db
      .select({ id: dbSchema.User.id, email: dbSchema.User.email })
      .from(dbSchema.User)
      .where(
        sql`${dbSchema.User.id} = ANY(${sql.raw(`ARRAY[${this.users.map((id) => `'${id}'`).join(',')}]`)})`
      )

    const messages = []
    const messageParticipants = []

    // Calculate messages per thread (distribute total messages across threads, max 5 per thread)
    const totalMessages = this.scenario.scales.messages
    const messagesPerThread = Math.min(5, Math.ceil(totalMessages / threads.length))

    console.log(
      `  📊 Distribution: ${threads.length} threads × ~${messagesPerThread} messages = ~${threads.length * messagesPerThread} total`
    )

    threads.forEach((thread: any, threadIndex: number) => {
      // Vary message count per thread (1-5 messages) but respect the average
      const messageCount = Math.min(5, messagesPerThread + (threadIndex % 2 === 0 ? 0 : -1))

      // Get thread participants (customer + support)
      const threadParticipantIds = thread.participantIds || []
      if (threadParticipantIds.length < 2) {
        console.log(`⚠️  Thread ${thread.id} has insufficient participants, skipping`)
        return
      }

      const customerParticipant = participantMap.get(threadParticipantIds[0])
      const supportParticipant = participantMap.get(threadParticipantIds[1])

      if (!customerParticipant || !supportParticipant) {
        console.log(`⚠️  Could not find participants for thread ${thread.id}, skipping`)
        return
      }

      // Find support user for createdById
      const supportUser = users.find((u: any) => u.email === supportParticipant.identifier)

      for (let i = 0; i < messageCount; i++) {
        // Alternate: Customer sends first (inbound), then support replies (outbound)
        const isInbound = i % 2 === 0
        const messageId = createId()
        const sentTime = new Date(Date.now() - (messageCount - i) * 3600000)

        if (isInbound) {
          // INBOUND: Customer → Support
          const messageContent = this.generateMessageContent(i, true)
          messages.push({
            id: messageId,
            threadId: thread.id,
            integrationId: thread.integrationId,
            integrationType: thread.integrationType,
            messageType: 'EMAIL',
            isInbound: true,
            isFirstInThread: i === 0,
            subject: thread.subject,
            textPlain: messageContent,
            textHtml: `<p>${messageContent}</p>`,
            snippet: messageContent.substring(0, 100), // First 100 chars as preview
            organizationId: thread.organizationId,
            fromId: customerParticipant.id, // FROM customer
            createdById: null, // Inbound messages have no creator
            isReply: i > 0,
            createdTime: sentTime,
            lastModifiedTime: sentTime,
            sentAt: sentTime,
            receivedAt: sentTime,
          })

          // FROM: customer
          messageParticipants.push({
            messageId: messageId,
            participantId: customerParticipant.id,
            contactId: customerParticipant.contactId, // Link to customer contact
            role: 'FROM',
          })

          // TO: support agent
          messageParticipants.push({
            messageId: messageId,
            participantId: supportParticipant.id,
            contactId: customerParticipant.contactId, // Link to customer contact
            role: 'TO',
          })
        } else {
          // OUTBOUND: Support → Customer
          const messageContent = this.generateMessageContent(i, false)
          messages.push({
            id: messageId,
            threadId: thread.id,
            integrationId: thread.integrationId,
            integrationType: thread.integrationType,
            messageType: 'EMAIL',
            isInbound: false,
            isFirstInThread: false,
            subject: `Re: ${thread.subject}`,
            textPlain: messageContent,
            textHtml: `<p>${messageContent}</p>`,
            snippet: messageContent.substring(0, 100), // First 100 chars as preview
            organizationId: thread.organizationId,
            fromId: supportParticipant.id, // FROM support
            createdById: supportUser?.id || null, // Support user who created it
            isReply: true,
            createdTime: sentTime,
            lastModifiedTime: sentTime,
            sentAt: sentTime,
          })

          // FROM: support
          messageParticipants.push({
            messageId: messageId,
            participantId: supportParticipant.id,
            contactId: customerParticipant.contactId, // Link to customer contact
            role: 'FROM',
          })

          // TO: customer
          messageParticipants.push({
            messageId: messageId,
            participantId: customerParticipant.id,
            contactId: customerParticipant.contactId, // Link to customer contact
            role: 'TO',
          })
        }
      }
    })

    // Insert messages in batches to avoid parameter limit
    if (messages.length > 0) {
      const BATCH_SIZE = 1000 // Safe batch size to avoid 65k parameter limit
      console.log(`📦 Inserting ${messages.length} messages in batches of ${BATCH_SIZE}...`)

      for (let i = 0; i < messages.length; i += BATCH_SIZE) {
        const batch = messages.slice(i, i + BATCH_SIZE)
        await db
          .insert(schema.Message)
          .values(batch)
          .onConflictDoUpdate({
            target: schema.Message.id,
            set: {
              subject: sql`excluded.subject`,
              textPlain: sql`excluded."textPlain"`,
              lastModifiedTime: sql`excluded."lastModifiedTime"`,
            },
          })
        console.log(
          `  ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(messages.length / BATCH_SIZE)} complete`
        )
      }

      console.log(`✅ Upserted ${messages.length} messages`)
    }

    // Insert message participants in batches
    if (messageParticipants.length > 0) {
      const BATCH_SIZE = 2000 // Smaller record size, can use larger batches
      console.log(
        `📦 Inserting ${messageParticipants.length} message participants in batches of ${BATCH_SIZE}...`
      )

      for (let i = 0; i < messageParticipants.length; i += BATCH_SIZE) {
        const batch = messageParticipants.slice(i, i + BATCH_SIZE)
        await db.insert(schema.MessageParticipant).values(batch).onConflictDoNothing()
        console.log(
          `  ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(messageParticipants.length / BATCH_SIZE)} complete`
        )
      }

      console.log(`✅ Upserted ${messageParticipants.length} message participants`)
    }
  }

  /**
   * generateMessageContent creates realistic message content.
   * @param index - Message index for variation
   * @param isInbound - Whether the message is inbound or outbound
   */
  private generateMessageContent(index: number, isInbound: boolean): string {
    if (isInbound) {
      const inboundMessages = [
        'Hello, I have a question about my recent order. Can you help me?',
        "I'd like to inquire about the shipping status of order #12345.",
        'I need to process a refund for my recent purchase. Please advise.',
        'Can you provide more information about your products?',
        "I'm experiencing an issue with my account. Please help.",
      ]
      return inboundMessages[index % inboundMessages.length]!
    } else {
      const outboundMessages = [
        "Thank you for contacting us! We're here to help.",
        "I've checked on your order status. Here's what I found...",
        "I'd be happy to assist you with that refund.",
        "Here's the information you requested about our products.",
        'Let me help you resolve that account issue.',
      ]
      return outboundMessages[index % outboundMessages.length]!
    }
  }

  /** buildRefinements returns drizzle-seed refinements for communication entities (DEPRECATED - use insertDirectly). */
  buildRefinements(): (helpers: unknown) => Record<string, unknown> {
    return (helpers: any) => {
      const ids = this.generateThreadIds()
      const subjects = this.generateThreadSubjects()
      const participantSets = this.generateThreadParticipantSets()
      const organizationIds = this.generateThreadOrganizationIds()
      const integrationIds = this.generateThreadIntegrationIds()
      const messageTypes = this.generateMessageTypes()
      const integrationTypes = this.generateIntegrationTypes()
      const assigneeIds = this.generateThreadAssigneeIds()
      const types = this.generateThreadTypes()
      const statuses = this.generateThreadStatuses()
      const messageCounts = this.generateMessageCounts()
      const participantCounts = this.generateParticipantCounts()
      const createdAt = this.generateThreadCreatedAt()
      const firstMessageAt = this.generateThreadFirstMessageAt()
      const lastMessageAt = this.generateThreadLastMessageAt()
      const inboxIds = this.generateThreadInboxIds()
      const metadata = this.generateThreadMetadata()

      const debugMap = {
        id: ids,
        subject: subjects,
        participantIds: participantSets,
        organizationId: organizationIds,
        integrationId: integrationIds,
        messageType: messageTypes,
        integrationType: integrationTypes,
        assigneeId: assigneeIds,
        type: types,
        status: statuses,
        messageCount: messageCounts,
        participantCount: participantCounts,
        createdAt,
        firstMessageAt,
        lastMessageAt,
        inboxId: inboxIds,
        metadata,
      }

      Object.entries(debugMap).forEach(([key, value]) => {
        console.log(`   ↳ Thread.${key}: ${value.length}`)
      })

      const result = {
        Thread: {
          count: this.scenario.scales.threads,
          columns: {
            id: helpers.valuesFromArray({ values: ids }),
            subject: helpers.valuesFromArray({ values: subjects }),
            participantIds: helpers.valuesFromArray({ values: participantSets }),
            organizationId: helpers.valuesFromArray({ values: organizationIds }),
            integrationId: helpers.valuesFromArray({ values: integrationIds }),
            messageType: helpers.valuesFromArray({ values: messageTypes }),
            integrationType: helpers.valuesFromArray({ values: integrationTypes }),
            assigneeId: helpers.valuesFromArray({ values: assigneeIds }),
            type: helpers.valuesFromArray({ values: types }),
            status: helpers.valuesFromArray({ values: statuses }),
            messageCount: helpers.valuesFromArray({ values: messageCounts }),
            participantCount: helpers.valuesFromArray({ values: participantCounts }),
            createdAt: helpers.valuesFromArray({ values: createdAt }),
            firstMessageAt: helpers.valuesFromArray({ values: firstMessageAt }),
            lastMessageAt: helpers.valuesFromArray({ values: lastMessageAt }),
            inboxId: helpers.valuesFromArray({ values: inboxIds }),
            metadata: helpers.valuesFromArray({ values: metadata }),
          },
        },
      }
      console.log('💬 Communication refinements prepared: Thread', this.scenario.scales.threads)
      return result
    }
  }

  // ---- Thread Generator Methods ----

  /** generateThreadSubjects creates realistic support thread subjects. */
  private generateThreadSubjects(): string[] {
    const emails = this.content.generateRealisticEmails(this.scenario.scales.threads)
    return emails.map((email) => email.subject)
  }

  /** generateIntegrationTypes creates realistic integration types. */
  private generateIntegrationTypes(): string[] {
    const result: string[] = []
    for (let i = 0; i < this.scenario.scales.threads; i++) {
      if (i % 100 < 60) result.push('GOOGLE')
      else if (i % 100 < 85) result.push('OUTLOOK')
      else if (i % 100 < 93) result.push('OPENPHONE')
      else result.push('FACEBOOK')
    }
    return result
  }

  /** generateMessageTypes creates realistic message types. */
  private generateMessageTypes(): string[] {
    const result: string[] = []
    for (let i = 0; i < this.scenario.scales.threads; i++) {
      if (i % 100 < 85) result.push('EMAIL')
      else if (i % 100 < 93) result.push('SMS')
      else if (i % 100 < 98) result.push('CHAT')
      else result.push('PHONE')
    }
    return result
  }

  /** generateThreadTypes creates realistic thread types. */
  private generateThreadTypes(): string[] {
    return Array(this.scenario.scales.threads).fill('EMAIL')
  }

  /** generateThreadStatuses creates realistic thread status distribution. */
  private generateThreadStatuses(): string[] {
    const result: string[] = []
    for (let i = 0; i < this.scenario.scales.threads; i++) {
      if (i % 100 < 40) result.push('OPEN')
      else if (i % 100 < 65) result.push('CLOSED')
      else if (i % 100 < 85) result.push('RESOLVED')
      else result.push('PENDING')
    }
    return result
  }

  /** generateMessageCounts creates realistic message counts per thread. */
  private generateMessageCounts(): number[] {
    const counts: number[] = []
    for (let i = 0; i < this.scenario.scales.threads; i++) {
      const complexity = this.distributions.selectWeightedValue(
        this.distributions.getThreadComplexityDistribution(),
        i
      )
      counts.push(complexity.messageCount)
    }
    return counts
  }

  /** generateParticipantCounts creates realistic participant counts. */
  private generateParticipantCounts(): number[] {
    return this.generateThreadParticipantSets().map((participants) => participants.length)
  }

  // ---- Message Generator Methods ----

  /** generateMessageSubjects creates realistic message subjects. */
  private generateMessageSubjects(): string[] {
    const emails = this.content.generateRealisticEmails(this.scenario.scales.messages)
    return emails.map((email) => email.subject)
  }

  /** generateHTMLContent creates realistic HTML email content. */
  private generateHTMLContent(): (string | null)[] {
    const content: (string | null)[] = []
    const emails = this.content.generateRealisticEmails(this.scenario.scales.messages)
    for (let i = 0; i < this.scenario.scales.messages; i++) {
      if (i % 10 === 0) {
        content.push(null) // 10% no HTML content
      } else {
        const emailContent = emails[i % emails.length]!.body
        content.push(`<div><p>${emailContent}</p></div>`)
      }
    }
    return content
  }

  /** generatePlainTextContent creates plain text message content. */
  private generatePlainTextContent(): string[] {
    const emails = this.content.generateRealisticEmails(this.scenario.scales.messages)
    return emails.map((email) => email.body)
  }

  /** generateSnippets creates message preview snippets. */
  private generateSnippets(): string[] {
    const emails = this.content.generateRealisticEmails(this.scenario.scales.messages)
    return emails.map((email) =>
      email.body.length > 150 ? email.body.substring(0, 150) + '...' : email.body
    )
  }

  /** generateInboundFlags creates realistic inbound/outbound distribution. */
  private generateInboundFlags(): boolean[] {
    const flags: boolean[] = []
    for (let i = 0; i < this.scenario.scales.messages; i++) {
      flags.push(i % 3 !== 0) // 67% inbound, 33% outbound
    }
    return flags
  }

  /** generateAutoReplyFlags creates auto-reply distribution. */
  private generateAutoReplyFlags(): boolean[] {
    const flags: boolean[] = []
    for (let i = 0; i < this.scenario.scales.messages; i++) {
      flags.push(i % 20 === 0) // 5% auto-replies
    }
    return flags
  }

  /** generateAIGeneratedFlags creates AI generation flags. */
  private generateAIGeneratedFlags(): boolean[] {
    const flags: boolean[] = []
    for (let i = 0; i < this.scenario.scales.messages; i++) {
      flags.push(i % 8 === 0) // 12.5% AI-generated
    }
    return flags
  }

  /** generateAttachmentFlags creates attachment presence flags. */
  private generateAttachmentFlags(): boolean[] {
    const flags: boolean[] = []
    for (let i = 0; i < this.scenario.scales.messages; i++) {
      flags.push(i % 6 === 0) // ~17% have attachments
    }
    return flags
  }

  /** generateKeywords creates message keywords for categorization. */
  private generateKeywords(): string[][] {
    const availableKeywords = [
      'order',
      'shipping',
      'return',
      'refund',
      'billing',
      'technical',
      'complaint',
      'compliment',
      'urgent',
      'question',
      'support',
    ]
    const keywordSets: string[][] = []
    for (let i = 0; i < this.scenario.scales.messages; i++) {
      const numKeywords = this.distributions.generateValueInRange(1, 3, i)
      const keywords: string[] = []
      for (let j = 0; j < numKeywords; j++) {
        const keyword = availableKeywords[(i + j) % availableKeywords.length]!
        if (!keywords.includes(keyword)) {
          keywords.push(keyword)
        }
      }
      keywordSets.push(keywords)
    }
    return keywordSets
  }

  /** getSeededStartDate returns a consistent start date for seeded data. */
  private getSeededStartDate(): Date {
    const now = new Date()
    return new Date(now.getFullYear() - 1, 0, 1) // One year ago
  }

  /** generateThreadIds produces deterministic cuid-based thread identifiers. */
  private generateThreadIds(): string[] {
    return Array.from({ length: this.scenario.scales.threads }, () => createId())
  }

  /** generateThreadOrganizationIds selects organization IDs for each thread. */
  private generateThreadOrganizationIds(): string[] {
    if (!this.services.organizations || this.services.organizations.length === 0) {
      throw new Error('CommunicationDomain requires organization references in the seeding context')
    }
    return Array.from(
      { length: this.scenario.scales.threads },
      (_, index) => this.services.organizations[index % this.services.organizations.length]!.id
    )
  }

  /** generateThreadIntegrationIds selects integration IDs for each thread. */
  private generateThreadIntegrationIds(): string[] {
    return Array.from(
      { length: this.scenario.scales.threads },
      (_, index) => this.services.integrations[index % this.services.integrations.length]!.id
    )
  }

  /** generateThreadAssigneeIds selects user IDs, leaving some threads unassigned. */
  private generateThreadAssigneeIds(): Array<string | null> {
    return Array.from({ length: this.scenario.scales.threads }, (_, index) => {
      if (index % 5 === 0) return null
      return this.users[index % this.users.length]!
    })
  }

  /** generateThreadParticipantSets composes participant lists per thread. */
  private generateThreadParticipantSets(): string[][] {
    if (this.threadParticipants) {
      return this.threadParticipants
    }
    this.threadParticipants = Array.from({ length: this.scenario.scales.threads }, (_, index) => {
      const participants: string[] = []
      const org = this.services.organizations[index % this.services.organizations.length]
      if (org) {
        participants.push(org.ownerId)
      }
      const user = this.users[(index + 1) % this.users.length]
      if (user) {
        participants.push(user)
      }
      return participants
    })
    return this.threadParticipants
  }

  /** generateThreadCreatedAt produces timestamps for thread creation. */
  private generateThreadCreatedAt(): Date[] {
    if (this.threadCreatedAt) {
      return this.threadCreatedAt
    }
    const base = Date.now() - this.scenario.scales.threads * 120000
    this.threadCreatedAt = Array.from(
      { length: this.scenario.scales.threads },
      (_, index) => new Date(base + index * 120000)
    )
    return this.threadCreatedAt
  }

  /** generateThreadFirstMessageAt aligns with createdAt timestamps. */
  private generateThreadFirstMessageAt(): Date[] {
    if (this.threadFirstMessageAt) {
      return this.threadFirstMessageAt
    }
    const created = this.generateThreadCreatedAt()
    this.threadFirstMessageAt = created.map((date) => new Date(date))
    return this.threadFirstMessageAt
  }

  /** generateThreadLastMessageAt offsets from first message timestamps. */
  private generateThreadLastMessageAt(): Date[] {
    if (this.threadLastMessageAt) {
      return this.threadLastMessageAt
    }
    const first = this.generateThreadFirstMessageAt()
    this.threadLastMessageAt = first.map(
      (date, index) => new Date(date.getTime() + (index % 10) * 60000)
    )
    return this.threadLastMessageAt
  }

  /** generateThreadInboxIds associates threads with inboxes or null. */
  private generateThreadInboxIds(): Array<string | null> {
    if (!this.services.inboxes || this.services.inboxes.length === 0) {
      return Array(this.scenario.scales.threads).fill(null)
    }
    return Array.from({ length: this.scenario.scales.threads }, (_, index) =>
      index % 4 === 0 ? null : this.services.inboxes[index % this.services.inboxes.length]!.id
    )
  }

  /** generateThreadMetadata provides lightweight metadata payloads. */
  private generateThreadMetadata(): Record<string, unknown>[] {
    if (this.threadMetadataCache) {
      return this.threadMetadataCache
    }
    this.threadMetadataCache = Array.from({ length: this.scenario.scales.threads }, (_, index) => ({
      importance: index % 10 === 0 ? 'high' : 'normal',
    }))
    return this.threadMetadataCache
  }
}
