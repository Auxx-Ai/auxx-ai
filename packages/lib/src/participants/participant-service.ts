// packages/lib/src/participants/participant-service.ts

import { type Database, database, schema } from '@auxx/database'
import type { IdentifierType, ParticipantEntity } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { identifierTypeForProvider } from '../channels/capabilities'
import { getIdentifier } from '../channels/internal/identifier'
import { generateVisitorName } from '../chat/visitor-naming'
import { classifyIsInternal } from './classify-internal'
import type { ParticipantIdentifierType, ParticipantMeta } from './client'

const logger = createScopedLogger('participant-service')

// Re-export types for convenience
export type { ParticipantMeta, ParticipantIdentifierType }

/**
 * Input type for finding or creating a participant.
 */
export interface FindOrCreateParticipantInput {
  identifier: string
  identifierType: IdentifierType
  name?: string | null
}

/**
 * Service class for managing Participants.
 */
export class ParticipantService {
  private readonly organizationId: string
  private db: Database

  /**
   * Creates an instance of ParticipantService.
   * @param organizationId - The ID of the organization this service instance operates for.
   * @param db - The Drizzle database instance.
   */
  constructor(organizationId: string, db: Database = database) {
    this.organizationId = organizationId
    this.db = db
  }

  /**
   * Classify whether an identifier is on the org's side of the conversation.
   *
   * Delegates to the shared {@link classifyIsInternal}. This used to be a
   * private EMAIL-only implementation that checked org domains and nothing
   * else, while ingest carried a second one that also checked the active
   * integration's own addresses — so the same address could be classified
   * differently depending on which path created the row.
   */
  private async _classifyIsInternal(
    identifier: string,
    identifierType: IdentifierType
  ): Promise<boolean> {
    return classifyIsInternal({
      organizationId: this.organizationId,
      identifier,
      identifierType,
    })
  }

  /**
   * Calculates display name and initials for a participant.
   *
   * For anonymous chat visitors the raw identifier is an opaque session UUID,
   * so when there's no name we surface the friendly `Chat user #xxxx` handle
   * instead. This is the single source of truth — every consumer that reads
   * `ParticipantMeta.displayName` gets the correct label without needing its
   * own fallback chain.
   */
  private _calculateDisplayInfo(
    name?: string | null,
    identifier?: string | null,
    identifierType?: IdentifierType | null
  ): {
    displayName: string
    initials: string
  } {
    const validName = name?.trim()
    const trimmedIdentifier = identifier?.trim()
    const identifierFallback =
      identifierType === 'CHAT_VISITOR' && trimmedIdentifier
        ? generateVisitorName(trimmedIdentifier)
        : (trimmedIdentifier ?? 'Unknown')
    const validIdentifier = identifierFallback
    const displayName = validName || validIdentifier
    let initials = '?'
    if (validName) {
      const nameParts = validName.split(' ').filter(Boolean)
      if (nameParts.length > 1) {
        initials =
          `${nameParts[0]?.[0] ?? ''}${nameParts[nameParts.length - 1]?.[0] ?? ''}`.toUpperCase()
      } else if (nameParts.length === 1) {
        initials = (nameParts[0]?.[0] ?? '').toUpperCase()
      }
    } else if (validIdentifier) {
      initials = (validIdentifier[0] ?? '?').toUpperCase()
      if (validIdentifier.includes('@')) {
        initials = (validIdentifier.split('@')[0]?.[0] ?? '?').toUpperCase()
      }
    }
    if (initials.length > 2) initials = initials.substring(0, 2)
    if (!initials || initials === '?') initials = displayName[0]?.toUpperCase() ?? '?'
    return { displayName, initials }
  }

  /**
   * Finds an existing participant or creates a new one based on identifier and type.
   * Ensures the participant is linked to the correct organization.
   * Normalizes email identifiers to lowercase.
   *
   * @param input - The participant identifier, type, and optional name.
   * @returns The found or created Participant record.
   * @throws Error if input is invalid or database operation fails.
   */
  async findOrCreateParticipant(input: FindOrCreateParticipantInput): Promise<ParticipantEntity> {
    let { identifier, identifierType, name } = input
    if (!identifier || !identifierType) {
      throw new Error('Identifier and identifierType are required.')
    }
    if (identifierType === 'EMAIL') {
      identifier = identifier.toLowerCase().trim()
    } else {
      identifier = identifier.trim()
    }
    logger.debug('Finding or creating participant', {
      identifier,
      identifierType,
      name: name ?? 'N/A',
      organizationId: this.organizationId,
    })
    try {
      const { displayName, initials } = this._calculateDisplayInfo(name, identifier, identifierType)
      const isInternal = await this._classifyIsInternal(identifier, identifierType)
      const updateValues: Record<string, unknown> = {
        ...(name !== undefined && { name: name }),
        ...(displayName !== undefined && { displayName: displayName }),
        ...(initials !== undefined && { initials: initials }),
        // Recomputed on every upsert — see the matching note in
        // `ingest/participants/find-or-create.ts`. Derived from org config, not
        // from message content, so last-writer-wins is always an improvement.
        isInternal,
        updatedAt: new Date(),
      }
      const [participant] = await this.db
        .insert(schema.Participant)
        .values({
          organizationId: this.organizationId,
          identifier: identifier,
          identifierType: identifierType as IdentifierType,
          name: name,
          displayName: displayName,
          initials: initials,
          isInternal,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            schema.Participant.organizationId,
            schema.Participant.identifier,
            schema.Participant.identifierType,
          ],
          set: updateValues,
        })
        .returning()

      if (!participant!.entityInstanceId) {
        logger.debug(`Participant ${participant!.id} created/found without entity instance link.`)
      }

      logger.debug(
        `Participant ${participant!.id} found or created. EntityInstance: ${participant!.entityInstanceId ?? 'None'}`
      )
      return participant!
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      logger.error('Failed to find or create participant', {
        identifier,
        identifierType,
        organizationId: this.organizationId,
        error: message,
        stack,
      })
      throw new Error(`Database error finding/creating participant: ${message}`)
    }
  }

  /**
   * Finds or creates a Participant record corresponding to a User within the organization.
   * Uses the user's primary email as the identifier.
   * @param userId - The ID of the User.
   * @returns The found or created Participant record for the user.
   * @throws Error if the user is not found, doesn't belong to the organization, or lacks an email.
   */
  async findOrCreateParticipantForUser(userId: string): Promise<ParticipantEntity> {
    logger.debug('Finding or creating participant for user', {
      userId,
      organizationId: this.organizationId,
    })
    const [user] = await this.db
      .select({
        id: schema.User.id,
        email: schema.User.email,
        name: schema.User.name,
      })
      .from(schema.User)
      .innerJoin(schema.OrganizationMember, eq(schema.OrganizationMember.userId, schema.User.id))
      .where(
        and(
          eq(schema.User.id, userId),
          eq(schema.OrganizationMember.organizationId, this.organizationId)
        )
      )
      .limit(1)
    if (!user) {
      logger.error('User not found or not part of the organization', {
        userId,
        organizationId: this.organizationId,
      })
      throw new Error(`User ${userId} not found or not member of org ${this.organizationId}.`)
    }
    if (!user.email) {
      logger.error('User does not have an email address', { userId })
      throw new Error(`User ${userId} lacks required email address.`)
    }
    try {
      const participant = await this.findOrCreateParticipant({
        identifier: user.email,
        identifierType: 'EMAIL' as IdentifierType,
        name: user.name,
      })
      logger.info('Successfully found/created participant for user', {
        userId,
        participantId: participant.id,
      })
      return participant
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      logger.error('Failed findOrCreateParticipant call within findOrCreateParticipantForUser', {
        userId,
        userEmail: user.email,
        error: message,
        stack,
      })
      throw error
    }
  }

  /**
   * Finds or creates the Participant that represents a channel's own sending
   * identity — the mailbox on an email channel (`markus@auxx.ai`), the phone
   * number on an SMS one (`+18889155797`). This is the correct FROM identity
   * for an outbound message: not the operator's login email, which may differ
   * from the mailbox and would otherwise collapse onto a recipient participant.
   *
   * **This used to read `Integration.email` and hardcode `EMAIL`.** A Quo
   * channel stores its identity in `metadata.phoneNumber` and leaves `email`
   * NULL, so it returned null, `message-sender.service.ts` fell through its
   * `??` to `findOrCreateParticipantForUser`, and every Auxx-composed SMS
   * recorded the operator's *email address* as its sender — on a phone thread,
   * in the phone thread's participant rollup, and permanently: the reconciler
   * never rewrites participants, so the Quo echo doesn't correct it. The wire
   * was always fine; only the DB row disagreed.
   *
   * Both halves come from the shared helpers so no per-provider knowledge lives
   * here: `getIdentifier` picks the identity off the row, and
   * `identifierTypeForProvider` says which id space it lives in.
   *
   * Returns `null` when the channel has no addressable identity of its own
   * (`chat`, whose org side is the agent's user participant), letting the
   * caller fall back to the user-based participant.
   *
   * @param integrationId - The integration the message is being sent from.
   * @returns The channel-identity Participant, or null to fall back.
   */
  async findOrCreateParticipantForIntegration(
    integrationId: string
  ): Promise<ParticipantEntity | null> {
    const [integration] = await this.db
      .select({
        provider: schema.Integration.provider,
        email: schema.Integration.email,
        name: schema.Integration.name,
        metadata: schema.Integration.metadata,
        organizationId: schema.Integration.organizationId,
      })
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.id, integrationId),
          eq(schema.Integration.organizationId, this.organizationId)
        )
      )
      .limit(1)

    if (!integration) {
      logger.warn('Integration not found when resolving FROM participant', {
        integrationId,
        organizationId: this.organizationId,
      })
      return null
    }

    const identifierType = identifierTypeForProvider(integration.provider)
    // `chat` resolves to CHAT_VISITOR — an id space that only ever names the
    // customer, never us — so there is no channel identity to mint. Same for a
    // provider with no declared type at all (`shopify`, or an unknown one).
    if (!identifierType || identifierType === 'CHAT_VISITOR') return null

    const identifier = getIdentifier({
      provider: integration.provider,
      email: integration.email,
      name: null, // never fall back to the channel's display name as an identifier
      metadata: integration.metadata,
    })
    if (!identifier) return null

    return this.findOrCreateParticipant({
      identifier,
      identifierType: identifierType as IdentifierType,
      name: integration.name,
    })
  }

  /**
   * Batch fetch participants by ID.
   * Returns participants in same order as input IDs (missing IDs are excluded).
   */
  async getParticipantMetaBatch(ids: string[]): Promise<ParticipantMeta[]> {
    if (ids.length === 0) return []
    if (ids.length > 100) throw new Error('Batch size exceeds limit of 100')

    logger.debug('Fetching participant metadata batch', {
      organizationId: this.organizationId,
      count: ids.length,
    })

    const participants = await this.db.query.Participant.findMany({
      where: and(
        inArray(schema.Participant.id, ids),
        eq(schema.Participant.organizationId, this.organizationId)
      ),
      columns: {
        id: true,
        name: true,
        identifier: true,
        identifierType: true,
        displayName: true,
        initials: true,
        entityInstanceId: true,
        isSpammer: true,
        isInternal: true,
      },
    })

    const participantMap = new Map(
      participants.map((p) => {
        // Trust the recomputed values over whatever's persisted: legacy
        // CHAT_VISITOR rows have the raw session UUID stored in `displayName`,
        // and `_calculateDisplayInfo` now produces the friendly handle.
        const { displayName, initials } = this._calculateDisplayInfo(
          p.name,
          p.identifier,
          p.identifierType
        )

        const meta: ParticipantMeta = {
          id: p.id,
          name: p.name,
          identifier: p.identifier,
          identifierType: p.identifierType as ParticipantIdentifierType,
          displayName,
          initials: p.initials || initials,
          avatarUrl: null,
          entityInstanceId: p.entityInstanceId,
          isSpammer: p.isSpammer ?? false,
          isInternal: p.isInternal ?? false,
        }
        return [p.id, meta]
      })
    )

    return ids
      .map((id) => participantMap.get(id))
      .filter((p): p is ParticipantMeta => p !== undefined)
  }
}
