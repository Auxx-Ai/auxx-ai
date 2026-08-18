// packages/lib/src/participants/participant-service.ts

import { type Database, database, schema } from '@auxx/database'
import type { IdentifierType, ParticipantEntity } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { identifierTypeForProvider } from '../channels/capabilities'
import { getIdentifier } from '../channels/internal/identifier'
import { classifyIsInternal } from './classify-internal'
import { type ParticipantIdentifierType, type ParticipantMeta, usableContactName } from './client'
import { calculateParticipantDisplayInfo } from './display-info'
import {
  diffParticipantNamePatch,
  type ParticipantPublishContext,
  publishParticipantPatch,
} from './publish-participant-changes'

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
   * Delegates to the exported {@link calculateParticipantDisplayInfo} — the
   * single source of truth shared with the search router — so every consumer
   * that reads `ParticipantMeta.displayName` gets the correct label (friendly
   * chat-visitor handles included) without needing its own fallback chain.
   */
  private _calculateDisplayInfo(
    name?: string | null,
    identifier?: string | null,
    identifierType?: IdentifierType | null
  ): {
    displayName: string
    initials: string
  } {
    return calculateParticipantDisplayInfo(name, identifier, identifierType)
  }

  /**
   * Finds an existing participant or creates a new one based on identifier and type.
   * Ensures the participant is linked to the correct organization.
   * Normalizes email identifiers to lowercase.
   *
   * When `publish` is supplied, tracked column changes (name / displayName /
   * isInternal) on an EXISTING row emit `participant:updated` on the given
   * inbox's lens channels — same diff-then-publish contract as ingest's
   * `findOrCreateParticipantRecord`. Callers with no inbox context omit it and
   * stay silent; publish failures never propagate.
   *
   * @param input - The participant identifier, type, and optional name.
   * @param publish - Optional realtime routing context (triggering inbox).
   * @returns The found or created Participant record.
   * @throws Error if input is invalid or database operation fails.
   */
  async findOrCreateParticipant(
    input: FindOrCreateParticipantInput,
    publish?: ParticipantPublishContext
  ): Promise<ParticipantEntity> {
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

      // Capture pre-upsert state so tracked column changes can emit
      // `participant:updated` (ingest precedent: a cheap point-lookup on the
      // unique index). Skipped entirely for silent callers.
      let previous:
        | { name: string | null; displayName: string | null; isInternal: boolean | null }
        | undefined
      if (publish) {
        const rows = await this.db
          .select({
            name: schema.Participant.name,
            displayName: schema.Participant.displayName,
            isInternal: schema.Participant.isInternal,
          })
          .from(schema.Participant)
          .where(
            and(
              eq(schema.Participant.organizationId, this.organizationId),
              eq(schema.Participant.identifier, identifier),
              eq(schema.Participant.identifierType, identifierType)
            )
          )
          .limit(1)
        previous = rows[0]
      }

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

      // Emit only when this was an UPDATE (previous row existed) AND a tracked
      // column actually changed — new rows don't get an event, matching ingest
      // (the FE looks them up on demand). Fire-and-forget: the helper swallows
      // publish failures so a realtime hiccup can never fail a send.
      if (publish && previous && participant) {
        const patch = diffParticipantNamePatch(previous, {
          name: participant.name,
          displayName: participant.displayName,
          isInternal: participant.isInternal,
        })
        if (Object.keys(patch).length > 0) {
          await publishParticipantPatch({
            organizationId: this.organizationId,
            participantId: participant.id,
            patch,
            inboxId: publish.inboxId,
            excludeSocketId: publish.excludeSocketId,
          })
        }
      }

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
  async findOrCreateParticipantForUser(
    userId: string,
    publish?: ParticipantPublishContext
  ): Promise<ParticipantEntity> {
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
      const participant = await this.findOrCreateParticipant(
        {
          identifier: user.email,
          identifierType: 'EMAIL' as IdentifierType,
          name: user.name,
        },
        publish
      )
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
    integrationId: string,
    publish?: ParticipantPublishContext
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

    return this.findOrCreateParticipant(
      {
        identifier,
        identifierType: identifierType as IdentifierType,
        name: integration.name,
      },
      publish
    )
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

    // Read-time contact projection: resolve linked contacts in one batch so a
    // renamed contact surfaces on mail without any write-through into
    // `Participant.name`. Archived contacts are skipped, so their participants
    // fall back to the header/identifier label (design decision 6).
    const contactIds = [
      ...new Set(
        participants
          .map((p) => p.entityInstanceId)
          .filter((id): id is string => typeof id === 'string')
      ),
    ]
    const contacts =
      contactIds.length > 0
        ? await this.db.query.EntityInstance.findMany({
            where: and(
              inArray(schema.EntityInstance.id, contactIds),
              eq(schema.EntityInstance.organizationId, this.organizationId),
              isNull(schema.EntityInstance.archivedAt)
            ),
            columns: { id: true, displayName: true, avatarUrl: true },
          })
        : []
    const contactById = new Map(contacts.map((c) => [c.id, c]))

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
        const contact = p.entityInstanceId ? contactById.get(p.entityInstanceId) : undefined

        const meta: ParticipantMeta = {
          id: p.id,
          name: p.name,
          identifier: p.identifier,
          identifierType: p.identifierType as ParticipantIdentifierType,
          displayName,
          initials: p.initials || initials,
          avatarUrl: contact?.avatarUrl ?? null,
          entityInstanceId: p.entityInstanceId,
          contactName: usableContactName(contact?.displayName, p.identifier),
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
