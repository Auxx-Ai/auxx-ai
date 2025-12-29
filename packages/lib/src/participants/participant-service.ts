// src/lib/participants/participant-service.ts
import { database, schema, type Database } from '@auxx/database'
import type { ParticipantEntity } from '@auxx/database/models'
import { createScopedLogger } from '@auxx/logger'
import { eq, and } from 'drizzle-orm'
import type { IdentifierType } from '@auxx/database/types'
const logger = createScopedLogger('participant-service')
/**
 * Input type for finding or creating a participant.
 */
export interface FindOrCreateParticipantInput {
  identifier: string
  identifierType: IdentifierType
  name?: string | null // Optional name
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
   * @param database - The Drizzle database instance.
   */
  constructor(organizationId: string, db: Database = database) {
    this.organizationId = organizationId
    this.db = database
  }
  // --- Private Helpers (Copied/Adapted from MessageStorageService for consistency) ---
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
      // Use first letter of identifier if no name
      initials = (validIdentifier[0] ?? '?').toUpperCase()
      // Refine for email: use first letter before @ if possible
      if (validIdentifier.includes('@')) {
        initials = (validIdentifier.split('@')[0]?.[0] ?? '?').toUpperCase()
      }
    }
    // Ensure initials are max 2 chars, fallback if needed
    if (initials.length > 2) initials = initials.substring(0, 2)
    if (!initials || initials === '?') initials = displayName[0]?.toUpperCase() ?? '?'
    return { displayName, initials }
  }
  /** Gets names from participant data. */
  private _getNamesFromParticipant(p: { name?: string | null; displayName?: string | null }): {
    firstName?: string | null
    lastName?: string | null
  } {
    const name = p.name?.trim()
    if (!name) return { firstName: p.displayName, lastName: null }
    const parts = name.split(' ').filter(Boolean)
    if (parts.length <= 1) return { firstName: parts[0] || p.displayName, lastName: null }
    return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] }
  }
  /** Decides if Contact name should be updated based on Participant name availability. */
  private _shouldUpdateContactName(
    p: {
      name?: string | null
    },
    c: {
      firstName?: string | null
      lastName?: string | null
    }
  ): boolean {
    return !!p.name?.trim() && !c.firstName && !c.lastName
  }
  // --- Core Methods ---
  /**
   * Finds an existing participant or creates a new one based on identifier and type.
   * Ensures the participant is linked to the correct organization.
   * Normalizes email identifiers to lowercase.
   *
   * // TODO (Refactor Target): Enhance this method to include the logic from
   * // MessageStorageService.findOrCreateContactForParticipant to automatically
   * // find/create/link the corresponding Contact record.
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
    // Normalize email addresses to lowercase
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
      const updateValues: any = {
        ...(name !== undefined && { name: name }), // Only update name if explicitly passed
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
          updatedAt: new Date(),
          // Contact linking will be handled separately or in a future enhancement here
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
      // --- START: Placeholder for Future Contact Linking ---
      if (!participant!.contactId) {
        // TODO: Implement contact linking logic here.
        // This would involve calling a private method like _linkOrCreateContact
        // which replicates the logic from MessageStorageService.findOrCreateContactForParticipant
        logger.debug(
          `Participant ${participant!.id} created/found without contact link. TODO: Implement linking.`
        )
        // const contactId = await this._linkOrCreateContact(participant);
        // If implemented, update the participant record:
        // return await this.db.participant.update({ where: { id: participant.id }, data: { contactId } });
      }
      // --- END: Placeholder ---
      logger.debug(
        `Participant ${participant!.id} found or created. Contact linking status: ${participant!.contactId ? 'Linked' : 'Not Linked (TODO)'}`
      )
      return participant!
    } catch (error: any) {
      logger.error('Failed to find or create participant', {
        identifier,
        identifierType,
        organizationId: this.organizationId,
        error: error.message,
        stack: error.stack,
      })
      throw new Error(`Database error finding/creating participant: ${error.message}`)
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
      // This call will find/create the participant, but contact linking is still TODO within findOrCreateParticipant
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
    } catch (error: any) {
      logger.error('Failed findOrCreateParticipant call within findOrCreateParticipantForUser', {
        userId,
        userEmail: user.email,
        error: error.message,
        stack: error.stack,
      })
      throw error
    }
  }
}
