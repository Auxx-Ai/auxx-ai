// packages/lib/src/ingest/participants/find-or-create.ts

import { schema } from '@auxx/database'
import {
  IdentifierType as IdentifierTypeEnum,
  ParticipantRole as ParticipantRoleEnum,
} from '@auxx/database/enums'
import type {
  IdentifierType,
  ParticipantEntity as Participant,
  ParticipantRole,
} from '@auxx/database/types'
import { eq } from 'drizzle-orm'
import { findOrCreateContactForParticipant } from '../contacts/find-or-create'
import type { IngestContext } from '../context'
import { extractRegistrableDomain, getOwnDomains, normalizeDomain } from '../domain/classifier'
import type { ParticipantInputData } from '../types'
import { calculateDisplayName, calculateInitials } from './display'
import { normalizeIdentifier } from './normalize'

/**
 * Compute whether an email identifier belongs to the org's own domains.
 * Reuses the per-batch `ownDomainsByOrg` cache to avoid repeated Redis reads.
 * Returns false for non-email identifiers.
 */
async function classifyIsInternal(
  ctx: IngestContext,
  identifier: string,
  identifierType: IdentifierType
): Promise<boolean> {
  if (identifierType !== IdentifierTypeEnum.EMAIL) return false
  const domain = extractRegistrableDomain(identifier)
  if (!domain) return false
  let ownDomains = ctx.ownDomainsByOrg.get(ctx.organizationId)
  if (!ownDomains) {
    ownDomains = await getOwnDomains(ctx.organizationId)
    ctx.ownDomainsByOrg.set(ctx.organizationId, ownDomains)
  }
  return ownDomains.has(normalizeDomain(domain))
}

/**
 * Upsert a Participant row and ensure it is linked to a Contact EntityInstance
 * (respecting integration record-creation mode). Updates `hasReceivedMessage`
 * and `lastSentMessageAt` when the participant is a recipient on an outbound
 * message — this is how we grow the contact graph in selective mode.
 */
export async function findOrCreateParticipantRecord(
  ctx: IngestContext,
  participantInput: ParticipantInputData,
  identifierType: IdentifierType,
  messageContext?: { isInbound: boolean; role: ParticipantRole }
): Promise<Participant> {
  if (!participantInput.identifier) {
    throw new Error('Participant identifier cannot be empty.')
  }
  const normalizedIdentifier = normalizeIdentifier(participantInput.identifier, identifierType)
  const name = participantInput.name?.trim() || null

  try {
    const initials = calculateInitials(name)
    const displayName = calculateDisplayName(name, normalizedIdentifier)

    const isOutboundRecipient =
      messageContext &&
      !messageContext.isInbound &&
      [ParticipantRoleEnum.TO, ParticipantRoleEnum.CC, ParticipantRoleEnum.BCC].includes(
        messageContext.role
      )

    const isInternal = await classifyIsInternal(ctx, normalizedIdentifier, identifierType)

    const participantData = await ctx.db
      .insert(schema.Participant)
      .values({
        identifier: normalizedIdentifier,
        identifierType,
        name,
        displayName,
        initials,
        organizationId: ctx.organizationId,
        isInternal,
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
          ...(name !== undefined && { name }),
          ...(displayName !== undefined && { displayName }),
          ...(initials !== undefined && { initials }),
          updatedAt: new Date(),
          ...(isOutboundRecipient && {
            hasReceivedMessage: true,
            lastSentMessageAt: new Date(),
          }),
        },
      })
      .returning()

    const participant = participantData[0]

    if (!participant.entityInstanceId) {
      const entityInstanceId = await findOrCreateContactForParticipant(
        ctx,
        participant,
        messageContext
      )
      if (entityInstanceId) {
        const updatedParticipants = await ctx.db
          .update(schema.Participant)
          .set({ entityInstanceId, updatedAt: new Date() })
          .where(eq(schema.Participant.id, participant.id))
          .returning()
        return updatedParticipants[0]
      }
    }

    return participant
  } catch (error) {
    ctx.logger.error('Error upserting participant record:', {
      error,
      identifier: normalizedIdentifier,
      type: identifierType,
    })
    throw error
  }
}
