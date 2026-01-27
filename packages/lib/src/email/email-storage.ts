// packages/lib/src/email/email-storage.ts

import { createScopedLogger } from '@auxx/logger'
import { database as db, schema } from '@auxx/database'
import { sql, and, eq, desc, inArray, isNull, asc } from 'drizzle-orm'
import type {
  ParticipantEntity as Participant,
  ContactEntity as Contact,
  MessageParticipantEntity as MessageParticipant,
  CustomerSourceEntity as CustomerSource,
} from '@auxx/database/models'
import { MessageReconcilerService } from '../messages/message-reconciler.service'
import { ThreadManagerService } from '../messages/thread-manager.service'
import {
  IdentifierType as IdentifierTypeEnum,
  ParticipantRole as ParticipantRoleEnum,
  MessageType,
  DraftMode,
  EmailLabel,
  ThreadStatus,
} from '@auxx/database/enums'
import type { IdentifierType, ParticipantRole } from '@auxx/database/types'

import type { MessageEntity as Message, ThreadEntity as Thread } from '@auxx/database/models'

import { SelectiveModeCache } from '../cache/selective-mode-cache'
import { v4 as uuidv4 } from 'uuid'

const logger = createScopedLogger('message-storage')

// Re-export enums for convenience
export {
  MessageType,
  DraftMode,
  EmailLabel,
  IdentifierTypeEnum as IdentifierType,
  ParticipantRoleEnum as ParticipantRole,
  ThreadStatus,
}

// JSON types
type JsonValue = any
type JsonArray = any

// --- Interfaces ---

// Interface for attachment data coming from providers
export interface EmailAttachment {
  id?: string // Optional: Provider's attachment ID might be used for upsert key
  filename: string
  mimeType: string
  size: number
  inline: boolean
  contentId?: string | null
  content?: string | null // Base64 content? Potentially large.
  contentLocation?: string | null // URL or storage path
}

// Structure for participant info provided by conversion methods
export interface ParticipantInputData {
  identifier: string // The raw identifier (email, phone, PSID, etc.)
  name?: string | null // Match Drizzle type
  raw?: string | null // Original raw string if available
}

// Structure for message data coming from provider conversion methods
export interface MessageData {
  externalId: string
  externalThreadId: string
  inboxId?: string
  integrationId: string
  organizationId: string // Essential context

  // Core message fields
  isInbound: boolean
  subject?: string | null
  textHtml?: string | null
  textPlain?: string | null
  snippet?: string | null
  metadata?: JsonValue | null
  createdTime: Date
  sentAt: Date
  receivedAt: Date

  // Participant Data
  from: ParticipantInputData // Required
  to: ParticipantInputData[] // Required, can be empty
  cc?: ParticipantInputData[]
  bcc?: ParticipantInputData[]
  replyTo?: ParticipantInputData[]

  // Attachments
  hasAttachments: boolean
  attachments: EmailAttachment[]

  // Optional/Provider-specific fields
  historyId?: number | null // DB schema uses bigint({ mode: 'number' })
  internetMessageId?: string | null
  keywords?: string[]
  labelIds?: string[] // Raw provider label IDs
  inReplyTo?: string | null
  references?: string | null
  threadIndex?: string | null
  folderId?: string | null
  internetHeaders?: JsonArray | null
  isAutoReply?: boolean | null
  isFirstInThread?: boolean | null // Provider might determine this
  isAIGenerated?: boolean | null
  draftMode?: (typeof DraftMode)[keyof typeof DraftMode] | null
  // emailLabel?: EmailLabel | null
}

/**
 * Interface for integration settings
 */
interface IntegrationSettings {
  recordCreation?: {
    mode: 'all' | 'selective' | 'none'
  }
  [key: string]: any
}

/**
 * Service class responsible for storing Messages, Threads, Participants,
 * and related data into the database based on the revised schema.
 */
export class MessageStorageService {
  private integrationSettings?: IntegrationSettings
  private selectiveCache: SelectiveModeCache
  private isInitialSync = false
  private reconciler?: MessageReconcilerService
  private threadManager?: ThreadManagerService
  private organizationId?: string

  constructor(organizationId?: string) {
    this.selectiveCache = new SelectiveModeCache()
    if (organizationId) {
      this.organizationId = organizationId
      this.reconciler = new MessageReconcilerService(
        organizationId,
        new ThreadManagerService(organizationId, db),
        db
      )
      this.threadManager = new ThreadManagerService(organizationId, db)
    }
  }

  // ========================================================================
  // Helper Functions (Internal)
  // ========================================================================

  /** Calculates initials (max 2) from a name string. */
  private calculateInitials(name?: string | null): string | undefined {
    if (!name) return undefined
    return (
      name
        .trim()
        .split(/\s+/)
        .map((word) => word.charAt(0))
        .filter((char) => char.match(/[a-zA-Z]/))
        .slice(0, 2)
        .join('')
        .toUpperCase() || undefined
    )
  }

  /** Calculates a display name, preferring name over identifier. */
  private calculateDisplayName(
    name?: string | null,
    identifier?: string | null
  ): string | undefined {
    const trimmedName = name?.trim()
    if (trimmedName) return trimmedName
    const trimmedIdentifier = identifier?.trim()
    if (trimmedIdentifier) {
      if (trimmedIdentifier.includes('@')) return trimmedIdentifier
      if (trimmedIdentifier.match(/^\+?\d+$/)) return trimmedIdentifier
      if (trimmedIdentifier.length > 20) return trimmedIdentifier.substring(0, 15) + '...'
      return trimmedIdentifier
    }
    return undefined
  }

  /** Normalizes an identifier based on its type. */
  private normalizeIdentifier(identifier: string, type: IdentifierType): string {
    const trimmed = identifier.trim()
    switch (type) {
      case IdentifierTypeEnum.EMAIL:
        return trimmed.toLowerCase()
      case IdentifierTypeEnum.PHONE: {
        const digits = trimmed.replace(/\D/g, '')
        return trimmed.startsWith('+') ? `+${digits}` : digits
      }
      default:
        return trimmed
    }
  }

  /** Determines IdentifierType based on integration provider and format guess. */
  private async determineIdentifierType(
    identifier: string,
    integrationId: string
  ): Promise<IdentifierType> {
    // Get provider from integration
    const [integration] = await db
      .select({ provider: schema.Integration.provider })
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)

    const provider = integration?.provider

    switch (provider) {
      case 'google':
      case 'outlook':
      case 'mailgun':
      case 'email':
        return 'EMAIL' as any
      case 'openphone':
      case 'sms':
        return 'PHONE' as any
      case 'facebook':
        return 'FACEBOOK_PSID' as any
      case 'instagram':
        return 'INSTAGRAM_IGSID' as any
      default: // Fallback guess
        if (identifier.includes('@')) return 'EMAIL' as any
        if (identifier.match(/^\+?\d{7,}$/)) return 'PHONE' as any // Basic phone guess
        logger.warn(
          `Could not reliably determine identifier type for integration provider ${provider}, identifier: ${identifier}. Defaulting to EMAIL.`
        )
        return 'EMAIL' as any // Risky fallback
    }
  }

  /** Gets names from participant data. */
  private getNamesFromParticipant(p: { name?: string | null; displayName?: string | null }): {
    firstName?: string | null
    lastName?: string | null
  } {
    const name = p.name?.trim()
    if (!name) return { firstName: p.displayName, lastName: null }
    const parts = name.split(' ').filter(Boolean)
    if (parts.length <= 1) return { firstName: parts[0] || p.displayName, lastName: null }
    return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] }
  }

  /**
   * Extract Internet Message-ID from message data
   */
  private extractInternetMessageId(messageData: MessageData): string | undefined {
    // Direct field
    if (messageData.internetMessageId) {
      return messageData.internetMessageId
    }

    // From headers in metadata
    const metadata = messageData.metadata as any
    const headers = metadata?.headers
    if (headers?.['message-id']) {
      return headers['message-id']
    }
    if (headers?.['Message-ID']) {
      return headers['Message-ID']
    }

    // From internet headers array
    if (messageData.internetHeaders && Array.isArray(messageData.internetHeaders)) {
      for (const header of messageData.internetHeaders) {
        const h = header as any
        if (h.name?.toLowerCase() === 'message-id' && h.value) {
          return h.value
        }
      }
    }

    return undefined
  }

  /**
   * Check if two subjects are similar enough to be the same message
   */
  private isSimilarSubject(
    subject1: string | null | undefined,
    subject2: string | null | undefined
  ): boolean {
    if (!subject1 || !subject2) return false

    // Normalize subjects
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/^(re:|fwd:|fw:)\s*/gi, '')
        .trim()
    const normalized1 = normalize(subject1)
    const normalized2 = normalize(subject2)

    // Exact match after normalization
    if (normalized1 === normalized2) return true

    // Check if one contains the other (for truncated subjects)
    if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) return true

    // Could add more sophisticated similarity checks (Levenshtein distance, etc.)
    return false
  }

  /**
   * Merge provider data into existing message without overwriting user content
   */
  private async mergeProviderData(existing: Message, providerData: MessageData): Promise<Message> {
    // Don't overwrite user-authored fields
    const mergedMetadata = {
      ...((existing.metadata as any) || {}),
      ...((providerData.metadata as any) || {}),
      reconciled: true,
      reconciledAt: new Date().toISOString(),
    } as JsonValue

    const [row] = await db
      .update(schema.Message)
      .set({
        textPlain: existing.textPlain ?? providerData.textPlain,
        textHtml: existing.textHtml ?? providerData.textHtml,
        snippet: existing.snippet ?? providerData.snippet,
        externalId: providerData.externalId ?? existing.externalId,
        externalThreadId: providerData.externalThreadId ?? existing.externalThreadId,
        hasAttachments: providerData.hasAttachments ?? existing.hasAttachments,
        sendStatus: existing.sendStatus === 'PENDING' ? 'SENT' : existing.sendStatus,
        metadata: mergedMetadata,
        // lastModifiedTime: new Date(),
      })
      .where(eq(schema.Message.id, existing.id))
      .returning()

    return row
  }

  /**
   * Reconcile message with existing data to prevent duplicates
   * Delegates to the MessageReconcilerService when available
   */
  private async reconcileMessage(messageData: MessageData): Promise<Message | null> {
    // Use the new reconciler service if available
    if (this.reconciler && this.organizationId) {
      const result = await this.reconciler.reconcileIncomingSync(messageData)

      if (result.isReconciled && result.existingMessageId) {
        // Get the full message object to return
        const [message] = await db
          .select()
          .from(schema.Message)
          .where(eq(schema.Message.id, result.existingMessageId))
          .limit(1)

        if (message) {
          logger.debug('Message reconciled by MessageReconcilerService', {
            messageId: message.id,
            externalId: messageData.externalId,
          })
          return message
        }
      }

      // No reconciliation found
      return null
    }

    // Fallback to legacy reconciliation if reconciler not available
    // Priority 1: Provider ID match
    if (messageData.externalId && messageData.integrationId) {
      try {
        const [existing] = await db
          .select()
          .from(schema.Message)
          .where(
            and(
              eq(schema.Message.integrationId, messageData.integrationId),
              eq(schema.Message.externalId, messageData.externalId)
            )
          )
          .limit(1)
        if (existing) {
          logger.debug('Message reconciled by externalId (legacy)', {
            messageId: existing.id,
            externalId: messageData.externalId,
          })
          return await this.mergeProviderData(existing, messageData)
        }
      } catch (error) {
        logger.error('Error checking externalId match', { error })
      }
    }

    // Priority 2: Internet Message-ID match
    const internetMessageId = this.extractInternetMessageId(messageData)
    if (internetMessageId && messageData.organizationId) {
      try {
        const [existing] = await db
          .select()
          .from(schema.Message)
          .where(
            and(
              eq(schema.Message.organizationId, messageData.organizationId),
              eq(schema.Message.internetMessageId, internetMessageId)
            )
          )
          .limit(1)
        if (existing) {
          logger.debug('Message reconciled by internetMessageId (legacy)', {
            messageId: existing.id,
            internetMessageId,
          })
          return await this.mergeProviderData(existing, messageData)
        }
      } catch (error) {
        logger.error('Error checking internetMessageId match', { error })
      }
    }

    // Priority 3: Heuristic match (careful!)
    // Only attempt if we have enough data
    if (messageData.externalThreadId && messageData.sentAt && messageData.from?.identifier) {
      try {
        // First need to find the thread
        const [thread] = await db
          .select()
          .from(schema.Thread)
          .where(
            and(
              eq(schema.Thread.integrationId, messageData.integrationId),
              eq(schema.Thread.externalId, messageData.externalThreadId)
            )
          )
          .limit(1)

        if (thread) {
          const timeWindowStart = new Date(messageData.sentAt.getTime() - 2 * 60 * 1000) // 2 minutes before
          const timeWindowEnd = new Date(messageData.sentAt.getTime() + 2 * 60 * 1000) // 2 minutes after

          const candidates = await db.query.Message.findMany({
            where: (t, { and, eq, gte, lte }) =>
              and(
                eq(t.threadId, thread.id),
                gte(t.sentAt, timeWindowStart as any),
                lte(t.sentAt, timeWindowEnd as any),
                eq(t.draftMode, 'NONE' as any)
              ),
            with: { from: true },
          })

          // Check for matching sender and similar subject
          const match = candidates.find((c) => {
            const senderMatch = c.from?.identifier === messageData.from.identifier
            const subjectMatch = this.isSimilarSubject(c.subject, messageData.subject)
            return senderMatch && subjectMatch
          })

          if (match) {
            logger.debug('Message reconciled by heuristic match (legacy)', {
              messageId: match.id,
              threadId: thread.id,
              subject: messageData.subject,
            })
            return await this.mergeProviderData(match, messageData)
          }
        }
      } catch (error) {
        logger.error('Error checking heuristic match', { error })
      }
    }

    // No match found
    return null
  }

  /** Decides if Contact name should be updated based on Participant name availability. */
  private shouldUpdateContactName(
    p: { name?: string | null },
    c: { firstName?: string | null; lastName?: string | null }
  ): boolean {
    return !!p.name?.trim() && !c.firstName && !c.lastName
  }

  /**
   * Sets the integration settings for this storage service instance.
   * @param settings The integration settings to use
   */
  setIntegrationSettings(settings: IntegrationSettings | undefined) {
    this.integrationSettings = settings
  }

  /**
   * Checks if the organization has sent a message to a participant.
   * @param participantId The ID of the participant
   * @param identifier The participant's identifier (email/phone)
   * @param organizationId The ID of the organization
   * @returns Promise<boolean> True if organization has sent to this participant
   */
  private async hasOrganizationSentToParticipant(
    participantId: string,
    identifier: string,
    organizationId: string
  ): Promise<boolean> {
    // Check cache first (persists across batches during initial sync)
    const cachedResult = await this.selectiveCache.hasSentToRecipient(identifier, organizationId)
    if (cachedResult) {
      return true
    }

    // Check the participant's hasReceivedMessage flag in database
    const [participant] = await db
      .select({
        hasReceivedMessage: schema.Participant.hasReceivedMessage,
      })
      .from(schema.Participant)
      .where(eq(schema.Participant.id, participantId))
      .limit(1)

    if (participant?.hasReceivedMessage) {
      // Cache this result for future checks
      await this.selectiveCache.markSentToRecipient(identifier, organizationId)
      return true
    }

    // Fallback: Query message history
    const [sentMessage] = await db
      .select({
        id: schema.MessageParticipant.id,
      })
      .from(schema.MessageParticipant)
      .innerJoin(schema.Message, eq(schema.MessageParticipant.messageId, schema.Message.id))
      .where(
        and(
          eq(schema.MessageParticipant.participantId, participantId),
          inArray(schema.MessageParticipant.role, [
            ParticipantRoleEnum.TO,
            ParticipantRoleEnum.CC,
            ParticipantRoleEnum.BCC,
          ]),
          eq(schema.Message.organizationId, organizationId),
          eq(schema.Message.isInbound, false)
        )
      )
      .limit(1)

    if (sentMessage) {
      // Update the participant record for future reference
      await db
        .update(schema.Participant)
        .set({
          hasReceivedMessage: true,
          lastSentMessageAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.Participant.id, participantId))
      // Cache this result
      await this.selectiveCache.markSentToRecipient(identifier, organizationId)
      return true
    }

    return false
  }

  /** Finds or creates Contact for a Participant, handling identifier association and selective mode. */
  private async findOrCreateContactForParticipant(
    participant: Participant,
    organizationId: string,
    messageContext?: { isInbound: boolean; role: ParticipantRole }
  ): Promise<string | null> {
    try {
      // Check record creation mode from settings
      const mode = this.integrationSettings?.recordCreation?.mode || 'selective' // Default to selective mode

      if (mode === 'none') {
        // Don't create any contacts automatically
        // First check if there's a contact already linked via participant
        const [existingViaParticipant] = await db
          .select({ id: schema.Contact.id })
          .from(schema.Contact)
          .innerJoin(schema.Participant, eq(schema.Contact.id, schema.Participant.contactId))
          .where(
            and(
              eq(schema.Contact.organizationId, organizationId),
              eq(schema.Participant.id, participant.id)
            )
          )
          .limit(1)

        if (existingViaParticipant) {
          return existingViaParticipant.id
        }

        // Check by email identifier
        if (participant.identifierType === IdentifierTypeEnum.EMAIL) {
          const [existingByEmail] = await db
            .select({ id: schema.Contact.id })
            .from(schema.Contact)
            .where(
              and(
                eq(schema.Contact.organizationId, organizationId),
                eq(schema.Contact.email, participant.identifier)
              )
            )
            .limit(1)

          if (existingByEmail) {
            return existingByEmail.id
          }
        }

        // Check by phone identifier
        if (participant.identifierType === IdentifierTypeEnum.PHONE) {
          const [existingByPhone] = await db
            .select({ id: schema.Contact.id })
            .from(schema.Contact)
            .where(
              and(
                eq(schema.Contact.organizationId, organizationId),
                eq(schema.Contact.phone, participant.identifier)
              )
            )
            .limit(1)

          if (existingByPhone) {
            return existingByPhone.id
          }
        }

        return null
      }

      if (mode === 'selective' && messageContext) {
        // Only create contacts for recipients of our outbound messages or existing contacts
        // First check if there's a contact already linked via participant
        const [existingViaParticipant] = await db
          .select({ id: schema.Contact.id })
          .from(schema.Contact)
          .innerJoin(schema.Participant, eq(schema.Contact.id, schema.Participant.contactId))
          .where(
            and(
              eq(schema.Contact.organizationId, organizationId),
              eq(schema.Participant.id, participant.id)
            )
          )
          .limit(1)

        if (existingViaParticipant) {
          return existingViaParticipant.id
        }

        // Check by email identifier
        if (participant.identifierType === IdentifierTypeEnum.EMAIL) {
          const [existingByEmail] = await db
            .select({ id: schema.Contact.id })
            .from(schema.Contact)
            .where(
              and(
                eq(schema.Contact.organizationId, organizationId),
                eq(schema.Contact.email, participant.identifier)
              )
            )
            .limit(1)

          if (existingByEmail) {
            return existingByEmail.id
          }
        }

        // Check by phone identifier
        if (participant.identifierType === IdentifierTypeEnum.PHONE) {
          const [existingByPhone] = await db
            .select({ id: schema.Contact.id })
            .from(schema.Contact)
            .where(
              and(
                eq(schema.Contact.organizationId, organizationId),
                eq(schema.Contact.phone, participant.identifier)
              )
            )
            .limit(1)

          if (existingByPhone) {
            return existingByPhone.id
          }
        }

        // Check if this is an outbound recipient
        const isOutboundRecipient =
          !messageContext.isInbound &&
          [ParticipantRoleEnum.TO, ParticipantRoleEnum.CC, ParticipantRoleEnum.BCC].includes(
            messageContext.role
          )

        if (!isOutboundRecipient) {
          // Check if we've previously sent to this participant
          const hasSentBefore = await this.hasOrganizationSentToParticipant(
            participant.id,
            participant.identifier,
            organizationId
          )

          if (!hasSentBefore) {
            // Don't create contact for inbound-only participants
            logger.info(
              `Skipping contact creation for inbound-only participant ${participant.id} (selective mode)`
            )
            return null
          }
        }
      }

      // Proceed with normal contact creation (mode === 'all' or criteria met)
      let contact: Contact | null = null

      // First check if there's a contact already linked via participant
      const [existingViaParticipant] = await db
        .select()
        .from(schema.Contact)
        .innerJoin(schema.Participant, eq(schema.Contact.id, schema.Participant.contactId))
        .where(
          and(
            eq(schema.Contact.organizationId, organizationId),
            eq(schema.Participant.id, participant.id)
          )
        )
        .limit(1)

      if (existingViaParticipant) {
        contact = existingViaParticipant.Contact
      } else {
        // Check by identifier type
        if (participant.identifierType === IdentifierTypeEnum.EMAIL) {
          const [existingByEmail] = await db
            .select()
            .from(schema.Contact)
            .where(
              and(
                eq(schema.Contact.organizationId, organizationId),
                eq(schema.Contact.email, participant.identifier)
              )
            )
            .limit(1)

          if (existingByEmail) {
            contact = existingByEmail
          }
        } else if (participant.identifierType === IdentifierTypeEnum.PHONE) {
          const [existingByPhone] = await db
            .select()
            .from(schema.Contact)
            .where(
              and(
                eq(schema.Contact.organizationId, organizationId),
                eq(schema.Contact.phone, participant.identifier)
              )
            )
            .limit(1)

          if (existingByPhone) {
            contact = existingByPhone
          }
        }
      }

      if (contact) {
        // Found existing contact - update if needed
        const needsUpdate =
          this.shouldUpdateContactName(participant, contact) ||
          (participant.identifierType === IdentifierTypeEnum.EMAIL &&
            contact.emails &&
            !contact.emails.includes(participant.identifier)) ||
          (participant.identifierType === IdentifierTypeEnum.PHONE &&
            contact.phone !== participant.identifier)

        if (needsUpdate) {
          const updateData: any = { updatedAt: new Date() }

          if (this.shouldUpdateContactName(participant, contact)) {
            Object.assign(updateData, this.getNamesFromParticipant(participant))
          }

          if (
            participant.identifierType === IdentifierTypeEnum.EMAIL &&
            contact.emails &&
            !contact.emails.includes(participant.identifier)
          ) {
            updateData.emails = [...(contact.emails || []), participant.identifier]
            if (!contact.email) updateData.email = participant.identifier
          }

          if (
            participant.identifierType === IdentifierTypeEnum.PHONE &&
            contact.phone !== participant.identifier
          ) {
            if (!contact.phone) updateData.phone = participant.identifier
          }

          await db.update(schema.Contact).set(updateData).where(eq(schema.Contact.id, contact.id))

          logger.debug(`Updated contact ${contact.id} with info from participant ${participant.id}`)
        }
        return contact.id
      } else {
        // Create new Contact
        logger.debug(`Creating new contact for participant ${participant.id}`)
        const names = this.getNamesFromParticipant(participant)

        const contactData: any = {
          organizationId,
          status: 'ACTIVE',
          ...names,
          createdAt: new Date(),
          updatedAt: new Date(),
        }

        if (participant.identifierType === IdentifierTypeEnum.EMAIL) {
          contactData.email = participant.identifier
          contactData.emails = [participant.identifier]
        }

        if (participant.identifierType === IdentifierTypeEnum.PHONE) {
          contactData.phone = participant.identifier
        }

        const [newContact] = await db
          .insert(schema.Contact)
          .values(contactData)
          .returning({ id: schema.Contact.id })

        logger.info(`Created new contact ${newContact.id}`)

        // Create source record - map IdentifierType to CustomerSource.source enum
        const sourceMapping: Record<string, string> = {
          [IdentifierTypeEnum.EMAIL]: 'EMAIL',
          [IdentifierTypeEnum.FACEBOOK_PSID]: 'FACEBOOK_PSID',
          [IdentifierTypeEnum.PHONE]: 'OTHER', // Map phone to OTHER since PHONE isn't in CustomerSource enum
          [IdentifierTypeEnum.INSTAGRAM_IGSID]: 'OTHER',
        }

        await db.insert(schema.CustomerSource).values({
          source: sourceMapping[participant.identifierType] || ('OTHER' as any),
          sourceId: participant.identifier,
          email:
            participant.identifierType === IdentifierTypeEnum.EMAIL ? participant.identifier : null,
          organizationId,
          contactId: newContact.id!,
          updatedAt: new Date(),
        })

        return newContact.id
      }
    } catch (error) {
      logger.error('Error finding/creating contact for participant:', {
        error,
        participantId: participant.id,
      })
      throw error
    }
  }

  /**
   * Finds or creates a Participant record, ensuring it's linked to a Contact.
   */
  private async findOrCreateParticipantRecord(
    participantInput: ParticipantInputData,
    identifierType: IdentifierType,
    organizationId: string,
    messageContext?: { isInbound: boolean; role: ParticipantRole }
  ): Promise<Participant> {
    if (!participantInput.identifier) {
      throw new Error('Participant identifier cannot be empty.')
    }
    const normalizedIdentifier = this.normalizeIdentifier(
      participantInput.identifier,
      identifierType
    )
    const name = participantInput.name?.trim() || null

    try {
      // Use Drizzle's upsert for Participant
      const initials = this.calculateInitials(name)
      const displayName = this.calculateDisplayName(name, normalizedIdentifier)

      // Determine if this is the first interaction and track it
      const isOutboundRecipient =
        messageContext &&
        !messageContext.isInbound &&
        [ParticipantRoleEnum.TO, ParticipantRoleEnum.CC, ParticipantRoleEnum.BCC].includes(
          messageContext.role
        )

      const participantData = await db
        .insert(schema.Participant)
        .values({
          identifier: normalizedIdentifier,
          identifierType: identifierType,
          name,
          displayName,
          initials,
          organizationId,
          // Set tracking fields on creation
          ...(messageContext && {
            firstInteractionType: messageContext.isInbound ? 'received' : 'sent',
            firstInteractionDate: new Date(),
            hasReceivedMessage: isOutboundRecipient || false,
            lastSentMessageAt: isOutboundRecipient ? new Date() : null,
          }),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            schema.Participant.organizationId,
            schema.Participant.identifier,
            schema.Participant.identifierType,
          ],
          set: {
            // Update name/display info if participant already exists
            ...(name !== undefined && { name: name }),
            ...(displayName !== undefined && { displayName: displayName }),
            ...(initials !== undefined && { initials: initials }),
            updatedAt: new Date(),
            // Update tracking fields if we're sending to them
            ...(isOutboundRecipient && {
              hasReceivedMessage: true,
              lastSentMessageAt: new Date(),
            }),
          },
        })
        .returning()

      const participant = participantData[0]

      // Ensure linked to contact (if appropriate based on settings)
      if (!participant.contactId) {
        const contactId = await this.findOrCreateContactForParticipant(
          participant,
          organizationId,
          messageContext
        )
        // Only update participant to link contact if a contact was created/found
        if (contactId) {
          const updatedParticipants = await db
            .update(schema.Participant)
            .set({ contactId: contactId, updatedAt: new Date() })
            .where(eq(schema.Participant.id, participant.id))
            .returning()

          return updatedParticipants[0]
        }
      }

      return participant
    } catch (error) {
      logger.error('Error upserting participant record:', {
        error,
        identifier: normalizedIdentifier,
        type: identifierType,
      })
      throw error
    }
  }

  /** Store an attachment */
  /**
   * Efficiently updates thread metadata using aggregate SQL
   * This runs a single query instead of multiple select + update queries
   */
  private async updateThreadMetadataEfficient(threadId: string): Promise<void> {
    try {
      await db.execute(sql`
        UPDATE "Thread" t
        SET
          "messageCount" = COALESCE((
            SELECT COUNT(*)
            FROM "Message"
            WHERE "threadId" = ${threadId}
              AND "draftMode" = 'NONE'
              AND "sentAt" IS NOT NULL
          ), 0),
          "firstMessageAt" = (
            SELECT MIN("sentAt")
            FROM "Message"
            WHERE "threadId" = ${threadId}
              AND "draftMode" = 'NONE'
              AND "sentAt" IS NOT NULL
          ),
          "lastMessageAt" = (
            SELECT MAX("sentAt")
            FROM "Message"
            WHERE "threadId" = ${threadId}
              AND "draftMode" = 'NONE'
              AND "sentAt" IS NOT NULL
          ),
          "latestMessageId" = (
            SELECT id
            FROM "Message"
            WHERE "threadId" = ${threadId}
              AND "draftMode" = 'NONE'
            ORDER BY "receivedAt" DESC NULLS LAST,
                     "sentAt" DESC NULLS LAST,
                     id DESC
            LIMIT 1
          ),
          "participantCount" = COALESCE((
            SELECT COUNT(DISTINCT "participantId")
            FROM "MessageParticipant" mp
            JOIN "Message" m ON mp."messageId" = m.id
            WHERE m."threadId" = ${threadId}
              AND m."draftMode" = 'NONE'
              AND mp."participantId" IS NOT NULL
          ), 0)
        WHERE t.id = ${threadId}
      `)

      logger.debug('Efficiently updated thread metadata', { threadId })
    } catch (error) {
      logger.error('Failed to update thread metadata efficiently', { threadId, error })
      // Don't throw - this is a non-critical operation
    }
  }

  private async storeAttachment(messageId: string, attachment: EmailAttachment): Promise<void> {
    const attachmentDbId = attachment.id || `${messageId}-${attachment.filename}-${attachment.size}` // Create a semi-unique ID if provider doesn't give one
    try {
      await db
        .insert(schema.EmailAttachment)
        .values({
          id: attachmentDbId,
          name: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          contentId: attachment.contentId ?? null,
          contentLocation: attachment.contentLocation ?? null,
          inline: attachment.inline,
          messageId,
        })
        .onConflictDoUpdate({
          target: schema.EmailAttachment.id,
          set: {
            name: attachment.filename,
            mimeType: attachment.mimeType,
            size: attachment.size,
            contentId: attachment.contentId ?? null,
            contentLocation: attachment.contentLocation ?? null,
            inline: attachment.inline,
            messageId,
          },
        })
      logger.debug('Stored/Updated attachment', { attachmentId: attachmentDbId, messageId })
    } catch (error) {
      logger.error('Error storing attachment:', { error, messageId, filename: attachment.filename })
      // Optional: throw error;
    }
  }

  // ========================================================================
  // Core Public Methods
  // ========================================================================

  /**
   * Stores a message and links its participants using the REVISED schema (Message.fromId -> Participant.id).
   * @param messageData - The message data object to store
   * @returns A Promise containing the ID of the stored message
   */
  async storeMessage(messageData: MessageData): Promise<string> {
    // Input validation
    if (!messageData.from?.identifier) {
      throw new Error(
        `Message externalId ${messageData.externalId} is missing required sender identifier.`
      )
    }

    try {
      // NEW: Reconcile by Message-ID first (prevents duplicate threads/messages)
      const existingByMsgId = messageData.internetMessageId
        ? (
            await db
              .select({
                id: schema.Message.id,
                threadId: schema.Message.threadId,
                externalId: schema.Message.externalId,
                textPlain: schema.Message.textPlain,
                textHtml: schema.Message.textHtml,
              })
              .from(schema.Message)
              .where(
                and(
                  eq(schema.Message.organizationId, messageData.organizationId),
                  eq(schema.Message.internetMessageId, messageData.internetMessageId)
                )
              )
              .limit(1)
          )?.[0]
        : null

      if (existingByMsgId) {
        logger.info('Reconciling message by internetMessageId', {
          messageId: existingByMsgId.id,
          internetMessageId: messageData.internetMessageId,
          incomingExternalId: messageData.externalId,
        })

        // Update message with provider data (don't overwrite user content)
        await db
          .update(schema.Message)
          .set({
            externalId: messageData.externalId,
            externalThreadId: messageData.externalThreadId,
            textPlain: existingByMsgId.textPlain ?? messageData.textPlain,
            textHtml: existingByMsgId.textHtml ?? messageData.textHtml,
            snippet: messageData.snippet ?? null,
            hasAttachments: messageData.hasAttachments,
            metadata: messageData.metadata ?? {},
            receivedAt: messageData.receivedAt,
            sentAt: messageData.sentAt,
            historyId: messageData.historyId ? BigInt(messageData.historyId) : null,
            isInbound: messageData.isInbound,
            draftMode: messageData.draftMode ?? DraftMode.NONE,
            updatedAt: new Date(),
          })
          .where(eq(schema.Message.id, existingByMsgId.id))

        // Update thread's externalId if it's still a placeholder
        if (messageData.externalThreadId && existingByMsgId.threadId) {
          const [thread] = await db
            .select({ externalId: schema.Thread.externalId })
            .from(schema.Thread)
            .where(eq(schema.Thread.id, existingByMsgId.threadId))
            .limit(1)

          if (
            thread &&
            (!thread.externalId ||
              thread.externalId.startsWith('new_') ||
              thread.externalId.startsWith('pending_'))
          ) {
            await db
              .update(schema.Thread)
              .set({ externalId: messageData.externalThreadId })
              .where(eq(schema.Thread.id, existingByMsgId.threadId))

            logger.info('Updated thread with real externalId', {
              threadId: existingByMsgId.threadId,
              externalId: messageData.externalThreadId,
            })
          }
        }

        // Update thread metadata
        await this.updateThreadMetadataEfficient(existingByMsgId.threadId)

        // Done: we reconciled, no thread upsert needed
        return existingByMsgId.id
      }

      // CRITICAL: Always check reconciliation with MessageReconcilerService first
      // This prevents duplicate threads by matching sent messages during sync
      const existingMessage = await this.reconcileMessage(messageData)
      if (existingMessage) {
        logger.info('Message reconciled with existing record via MessageReconcilerService', {
          messageId: existingMessage.id,
          externalId: messageData.externalId,
        })

        // Promote thread externalId if needed
        if (existingMessage.threadId && messageData.externalThreadId) {
          const [thread] = await db
            .select({ externalId: schema.Thread.externalId })
            .from(schema.Thread)
            .where(eq(schema.Thread.id, existingMessage.threadId))
            .limit(1)

          const ext = thread?.externalId
          if (
            !ext ||
            ext.startsWith('new_') ||
            ext.startsWith('pending_') ||
            ext.startsWith('draft_') ||
            (ext.includes('-') && ext.length === 36)
          ) {
            await db
              .update(schema.Thread)
              .set({ externalId: messageData.externalThreadId })
              .where(eq(schema.Thread.id, existingMessage.threadId))

            logger.info('Promoted thread externalId from placeholder during reconciliation', {
              threadId: existingMessage.threadId,
              oldExternalId: ext,
              newExternalId: messageData.externalThreadId,
            })
          }
        }

        // Update thread metadata if needed
        if (existingMessage.threadId) {
          await this.updateThreadMetadataEfficient(existingMessage.threadId)
        }

        return existingMessage.id
      }

      logger.info('Storing new message (Schema: Msg->Participant)', {
        externalId: messageData.externalId,
        integrationId: messageData.integrationId,
      })

      // Fetch integration settings if not already loaded
      if (!this.integrationSettings && messageData.integrationId) {
        const [integration] = await db
          .select({ metadata: schema.Integration.metadata })
          .from(schema.Integration)
          .where(eq(schema.Integration.id, messageData.integrationId))
          .limit(1)

        this.integrationSettings = (integration?.metadata as any)?.settings as
          | IntegrationSettings
          | undefined
      }

      // --- 1. Process ALL Participants & Cache Results ---
      const participantCache = new Map<string, Participant>() // Key: "TYPE:normalized_identifier"
      const participantInputsWithRoles: Array<{
        role: ParticipantRole
        data: ParticipantInputData
      }> = []

      const processAndCacheParticipant = async (
        data: ParticipantInputData,
        role?: ParticipantRole
      ): Promise<Participant | null> => {
        if (!data?.identifier) return null
        const identifierType = await this.determineIdentifierType(
          data.identifier,
          messageData.integrationId
        )
        const normalizedId = this.normalizeIdentifier(data.identifier, identifierType)
        const cacheKey = `${identifierType}:${normalizedId}`

        if (participantCache.has(cacheKey)) {
          return participantCache.get(cacheKey)!
        } else {
          // Pass message context when creating participants
          const messageContext = role
            ? {
                isInbound: messageData.isInbound,
                role: role,
              }
            : undefined

          const participantRecord = await this.findOrCreateParticipantRecord(
            data,
            identifierType,
            messageData.organizationId,
            messageContext
          )
          participantCache.set(cacheKey, participantRecord)
          return participantRecord
        }
      }

      // Collect roles and ensure all unique participants are processed and cached
      const allInputs = [
        { role: ParticipantRoleEnum.FROM, data: messageData.from },
        ...messageData.to.map((p) => ({ role: ParticipantRoleEnum.TO, data: p })),
        ...(messageData.cc || []).map((p) => ({ role: ParticipantRoleEnum.CC, data: p })),
        ...(messageData.bcc || []).map((p) => ({ role: ParticipantRoleEnum.BCC, data: p })),
        ...(messageData.replyTo || []).map((p) => ({
          role: ParticipantRoleEnum.REPLY_TO,
          data: p,
        })),
      ]

      for (const { role, data } of allInputs) {
        if (data?.identifier) {
          participantInputsWithRoles.push({ role, data }) // Keep track of all roles
          await processAndCacheParticipant(data, role) // Ensure participant exists in cache with role context
        } else {
          logger.warn('Skipping participant input due to missing identifier', { role })
        }
      }

      // --- 2. Get Sender and ReplyTo Participant IDs from Cache ---
      const senderParticipant = await processAndCacheParticipant(
        messageData.from,
        ParticipantRoleEnum.FROM
      ) // Ensures sender is processed
      if (!senderParticipant) {
        throw new Error(
          `Failed to process sender participant for message ${messageData.externalId}`
        )
      }
      const senderParticipantId = senderParticipant.id

      let firstReplyToParticipantId: string | null = null
      if (messageData.replyTo && messageData.replyTo.length > 0) {
        const replyToParticipant = await processAndCacheParticipant(
          messageData.replyTo[0],
          ParticipantRoleEnum.REPLY_TO
        )
        firstReplyToParticipantId = replyToParticipant?.id ?? null
      }

      // --- 3. Prepare participant IDs for thread ---
      // Extract all unique participant IDs from the current message
      const currentMessageParticipantIds: string[] = []
      for (const participant of participantCache.values()) {
        if (participant?.id) {
          currentMessageParticipantIds.push(participant.id)
        }
      }

      // --- 4. Upsert Thread ---
      const threadData = await db
        .insert(schema.Thread)
        .values({
          externalId: messageData.externalThreadId,
          integrationId: messageData.integrationId,
          organizationId: messageData.organizationId,
          subject: messageData.subject ?? 'No Subject',
          status: ThreadStatus.OPEN,
          firstMessageAt: messageData.sentAt,
          lastMessageAt: messageData.sentAt,
          messageCount: 1, // This is the first message
          participantCount: currentMessageParticipantIds.length,
        })
        .onConflictDoUpdate({
          target: [schema.Thread.integrationId, schema.Thread.externalId],
          set: {
            // Minimal updates for existing threads
            subject: messageData.subject || undefined,
          },
        })
        .returning({
          id: schema.Thread.id,
          messageCount: schema.Thread.messageCount,
          firstMessageAt: schema.Thread.firstMessageAt,
          lastMessageAt: schema.Thread.lastMessageAt,
          participantCount: schema.Thread.participantCount,
        })

      const thread = threadData[0]
      const isNewThread =
        (thread.messageCount ?? 0) === 1 &&
        thread.firstMessageAt?.getTime() === messageData.sentAt.getTime()

      // --- 4. Upsert Message ---
      const messageRecords = await db
        .insert(schema.Message)
        .values({
          externalThreadId: messageData.externalThreadId,
          threadId: thread.id,
          organizationId: messageData.organizationId,
          integrationId: messageData.integrationId,
          historyId: messageData.historyId ? Number(messageData.historyId) : null,
          createdAt: messageData.createdTime,
          updatedAt: new Date(),
          sentAt: messageData.sentAt,
          receivedAt: messageData.receivedAt,
          internetMessageId:
            this.extractInternetMessageId(messageData) || messageData.internetMessageId,
          subject: messageData.subject ?? '',
          hasAttachments: messageData.hasAttachments,
          textHtml: messageData.textHtml,
          textPlain: messageData.textPlain,
          snippet: messageData.snippet,
          metadata: messageData.metadata || null,
          isInbound: messageData.isInbound,
          isFirstInThread: isNewThread,
          draftMode: messageData.draftMode ?? ('NONE' as any),
          fromId: senderParticipantId, // Set direct link on create
          replyToId: firstReplyToParticipantId, // Set direct link on create (optional)
        })
        .onConflictDoUpdate({
          target: [schema.Message.integrationId, schema.Message.externalId],
          set: {
            threadId: thread.id,
            historyId: messageData.historyId ? Number(messageData.historyId) : null,
            updatedAt: new Date(),
            sentAt: messageData.sentAt,
            receivedAt: messageData.receivedAt,
            subject: messageData.subject || '',
            hasAttachments: messageData.hasAttachments,
            textHtml: messageData.textHtml,
            textPlain: messageData.textPlain,
            snippet: messageData.snippet,
            metadata: messageData.metadata || null,
            isInbound: messageData.isInbound,
            draftMode: messageData.draftMode ?? ('NONE' as any),
            fromId: senderParticipantId, // Update direct link
            replyToId: firstReplyToParticipantId, // Update direct link
          },
        })
        .returning({ id: schema.Message.id })

      const messageRecord = messageRecords[0]

      // --- 5. Create MessageParticipant Links ---
      const messageParticipantData: any[] = []
      for (const { role, data } of participantInputsWithRoles) {
        if (!data?.identifier) continue
        const identifierType = await this.determineIdentifierType(
          data.identifier,
          messageData.integrationId
        )
        const normalizedId = this.normalizeIdentifier(data.identifier, identifierType)
        const participantId = participantCache.get(`${identifierType}:${normalizedId}`)?.id
        if (participantId) {
          messageParticipantData.push({
            messageId: messageRecord.id,
            participantId: participantId,
            role: role,
          })
        } else {
          logger.error(
            `Participant ID not found in cache for ${normalizedId} while creating MessageParticipant links.`
          )
        }
      }
      if (messageParticipantData.length > 0) {
        // Use insert with onConflictDoNothing for idempotency
        await db
          .insert(schema.MessageParticipant)
          .values(messageParticipantData)
          .onConflictDoNothing()

        logger.debug(
          `Created/Skipped ${messageParticipantData.length} MessageParticipant links for message ${messageRecord.id}`
        )
      }

      // --- 6. Store Attachments ---
      if (messageData.attachments.length > 0) {
        await Promise.all(
          messageData.attachments.map((att) => this.storeAttachment(messageRecord.id, att))
        )
      }

      // --- 7. Update Thread Metadata (if needed) ---
      // Smart decision: only update if thread metadata might be stale
      const shouldUpdateThreadMetadata =
        !isNewThread &&
        (!thread.firstMessageAt ||
          !thread.lastMessageAt ||
          messageData.sentAt < thread.firstMessageAt ||
          messageData.sentAt > thread.lastMessageAt)

      if (shouldUpdateThreadMetadata) {
        // Use efficient aggregate update instead of multiple queries
        await this.updateThreadMetadataEfficient(thread.id)
      }

      logger.info('Message stored successfully (Revised Schema v2)', {
        messageId: messageRecord.id,
        externalId: messageData.externalId,
      })
      return messageRecord.id
    } catch (error: any) {
      logger.error('Error storing message (Revised Schema v2):', {
        error: error.message,
        externalId: messageData?.externalId ?? 'UNKNOWN',
        stack: error.stack,
      })
      // Check for unique constraint violation (P2002, similar concept in PostgreSQL)
      if (error.message?.includes('duplicate key') || error.code === '23505') {
        logger.warn(
          `Unique constraint violation storing message ${messageData?.externalId ?? 'UNKNOWN'}. Assuming already processed.`
        )
        const [existing] = await db
          .select({ id: schema.Message.id })
          .from(schema.Message)
          .where(
            and(
              eq(schema.Message.integrationId, messageData.integrationId),
              eq(schema.Message.externalId, messageData.externalId)
            )
          )
          .limit(1)

        if (existing) return existing.id // Return existing ID
      }
      throw error
    }
  }

  /**
   * Stores multiple messages in batch mode with optimizations for initial sync.
   * @param messages Array of message data to store
   * @param batchId Optional batch identifier for tracking
   * @param isInitialSync Whether this is part of an initial sync operation
   * @returns Number of successfully stored messages
   */
  async batchStoreMessages(
    messages: MessageData[],
    batchId?: string,
    isInitialSync: boolean = false
  ): Promise<number> {
    if (messages.length === 0) return 0

    const organizationId = messages[0]?.organizationId
    if (!organizationId) {
      logger.error('No organizationId found in batch messages')
      return 0
    }

    // Generate batch ID if not provided
    const actualBatchId = batchId || uuidv4()

    // Track batch processing if this is initial sync
    if (isInitialSync) {
      this.isInitialSync = true
      await this.selectiveCache.markBatchProcessing(organizationId, actualBatchId)
    }

    // Sort messages chronologically for accurate selective mode processing
    const sortedMessages = [...messages].sort(
      (a, b) => (a.sentAt?.getTime() || 0) - (b.sentAt?.getTime() || 0)
    )

    logger.info(`Starting batch store for ${messages.length} messages (sorted chronologically)`, {
      batchId: actualBatchId,
      isInitialSync,
      organizationId,
    })

    let successCount = 0
    for (const message of sortedMessages) {
      try {
        await this.storeMessage(message)
        successCount++

        // Update cache for outbound messages during initial sync
        if (isInitialSync && !message.isInbound) {
          const recipients = [...message.to, ...(message.cc || []), ...(message.bcc || [])]

          const recipientIdentifiers = recipients
            .map((r) => r?.identifier)
            .filter(Boolean) as string[]

          if (recipientIdentifiers.length > 0) {
            await this.selectiveCache.markMultipleSentToRecipients(
              recipientIdentifiers,
              organizationId
            )
          }
        }
      } catch (error) {
        logger.error('Error storing message in batch:', {
          error: (error as Error).message,
          externalId: message.externalId,
          batchId: actualBatchId,
        })
        // Continue with the next message
      }
    }

    // Complete batch tracking
    if (isInitialSync) {
      await this.selectiveCache.completeBatch(organizationId, actualBatchId, successCount)
      this.isInitialSync = false
    }

    logger.info(`Batch store completed: ${successCount} of ${messages.length} messages stored.`, {
      batchId: actualBatchId,
      organizationId,
    })

    return successCount
  }

  /**
   * Sets the initial sync mode for the storage service.
   * @param enabled Whether initial sync mode is enabled
   */
  setInitialSyncMode(enabled: boolean) {
    this.isInitialSync = enabled
    if (!enabled) {
      // Initial sync completed, cache will persist with TTL
      logger.info('Initial sync mode disabled - cache will persist for subsequent batches')
    }
  }

  // --- Retrieval Methods (Update Includes) ---

  /** Retrieves messages for a specific thread, including participant details */
  async getThreadMessages(threadId: string): Promise<Message[]> {
    try {
      const messages = await db.query.Message.findMany({
        where: (messages, { eq }) => eq(messages.threadId, threadId),
        orderBy: (messages, { asc }) => [asc(messages.sentAt)],
        with: {
          from: true, // Include the direct sender Participant
          replyTo: true, // Include the direct replyTo Participant (optional)
          participants: {
            // Include the join table records
            orderBy: (participants, { asc }) => [asc(participants.role)], // Consistent role order
            with: {
              participant: true, // Include the actual Participant details
            },
          },
          attachments: true,
        },
      })
      return messages as Message[]
    } catch (error) {
      logger.error('Error getting thread messages:', { error, threadId })
      throw error
    }
  }

  /** Retrieves a specific thread by its internal ID */
  async getThread(threadId: string, organizationId: string): Promise<Thread | null> {
    // Added organizationId parameter for security/scoping
    try {
      const thread = await db.query.Thread.findFirst({
        where: (threads, { and, eq }) =>
          and(eq(threads.id, threadId), eq(threads.organizationId, organizationId)),
        with: {
          labels: { with: { label: true } },
          tags: { with: { tag: true } },
          assignee: true,
          // Note: inbox relation removed - Thread.inboxId was removed in migration 0028
          integration: true, // Added to support provider-based type derivation
          // Include first/last message snippet + sender participant?
          messages: {
            orderBy: (messages, { desc }) => [desc(messages.sentAt)], // Get last message
            limit: 1,
            with: { from: true }, // Include sender Participant
          },
        },
      })
      return thread as Thread | null
    } catch (error) {
      logger.error('Error getting thread:', { error, threadId })
      throw error
    }
  }

  // getThreads, getAllProviderMessages etc. would need similar reviews of their 'include' and 'where' clauses
  // based on how participant filtering/display is required.

  /**
   * Creates a contact for a participant after sending them a message.
   * Used when we send a message to someone who previously only sent us messages.
   * @param participantId The ID of the participant
   * @param organizationId The ID of the organization
   */
  async createContactAfterOutboundMessage(
    participantId: string,
    organizationId: string
  ): Promise<void> {
    try {
      const participant = await db.query.Participant.findFirst({
        where: (participants, { eq }) => eq(participants.id, participantId),
        with: { contact: true },
      })

      if (!participant) {
        logger.warn(`Participant ${participantId} not found for retroactive contact creation`)
        return
      }

      // Skip if already has contact
      if (participant.contact) {
        return
      }

      // Create contact for this participant
      const contactId = await this.findOrCreateContactForParticipant(
        participant,
        organizationId,
        { isInbound: false, role: ParticipantRoleEnum.TO } // Treat as outbound recipient
      )

      if (contactId) {
        // Update participant to link contact and mark as having received message
        await db
          .update(schema.Participant)
          .set({
            contactId,
            hasReceivedMessage: true,
            lastSentMessageAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.Participant.id, participantId))

        logger.info(`Created retroactive contact ${contactId} for participant ${participantId}`)
      }
    } catch (error) {
      logger.error('Error creating retroactive contact:', {
        error,
        participantId,
        organizationId,
      })
    }
  }

  /**
   * Ensures contacts exist for all recipients when sending messages in selective mode.
   * @param recipients Array of email/phone identifiers
   * @param organizationId The organization ID
   * @param integrationId The integration ID
   */
  async ensureContactsForRecipients(
    recipients: string[],
    organizationId: string,
    integrationId: string
  ): Promise<void> {
    const mode = this.integrationSettings?.recordCreation?.mode || 'selective' // Default to selective mode

    if (mode !== 'selective') {
      return // Only needed in selective mode
    }

    for (const identifier of recipients) {
      if (!identifier) continue

      const identifierType = await this.determineIdentifierType(identifier, integrationId)
      const normalizedId = this.normalizeIdentifier(identifier, identifierType)

      // Find or create participant
      const [participant] = await db
        .select()
        .from(schema.Participant)
        .where(
          and(
            eq(schema.Participant.organizationId, organizationId),
            eq(schema.Participant.identifier, normalizedId),
            eq(schema.Participant.identifierType, identifierType as any)
          )
        )
        .limit(1)

      if (participant && !participant.contactId) {
        // Create contact for this participant since we're sending to them
        await this.createContactAfterOutboundMessage(participant.id, organizationId)
      }
    }
  }
} // End of MessageStorageService class
