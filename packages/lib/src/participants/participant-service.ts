// packages/lib/src/participants/participant-service.ts

import { type Database, database, schema } from '@auxx/database'
import type { IdentifierType, ParticipantEntity } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import {
  extractRegistrableDomain,
  getOwnDomains,
  normalizeDomain,
} from '../ingest/domain/classifier'
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
   * Classify whether an email identifier belongs to the org's own domains.
   * Returns false for non-email identifiers or when the domain can't be parsed.
   */
  private async _classifyIsInternal(
    identifier: string,
    identifierType: IdentifierType
  ): Promise<boolean> {
    if (identifierType !== 'EMAIL') return false
    const domain = extractRegistrableDomain(identifier)
    if (!domain) return false
    const ownDomains = await getOwnDomains(this.organizationId)
    return ownDomains.has(normalizeDomain(domain))
  }

  /** Calculates display name and initials for a participant. */
  private _calculateDisplayInfo(
    name?: string | null,
    identifier?: string | null
  ): {
    displayName: string
    initials: string
  } {
    const validName = name?.trim()
    const validIdentifier = identifier?.trim() ?? 'Unknown'
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
      const { displayName, initials } = this._calculateDisplayInfo(name, identifier)
      const isInternal = await this._classifyIsInternal(identifier, identifierType)
      const updateValues: Record<string, unknown> = {
        ...(name !== undefined && { name: name }),
        ...(displayName !== undefined && { displayName: displayName }),
        ...(initials !== undefined && { initials: initials }),
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
        const { displayName, initials } = this._calculateDisplayInfo(p.name, p.identifier)

        const meta: ParticipantMeta = {
          id: p.id,
          name: p.name,
          identifier: p.identifier,
          identifierType: p.identifierType as ParticipantIdentifierType,
          displayName: p.displayName || displayName,
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
