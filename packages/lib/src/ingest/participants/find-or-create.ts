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
import { and, eq } from 'drizzle-orm'
import { getRealtimeService, publishParticipantUpdated } from '../../realtime'
import type { ParticipantMeta } from '../../realtime/events'
import { findOrCreateContactForParticipant } from '../contacts/find-or-create'
import type { IngestContext } from '../context'
import { extractRegistrableDomain, getOwnDomains, normalizeDomain } from '../domain/classifier'
import type { ParticipantInputData } from '../types'
import { calculateDisplayName, calculateInitials } from './display'
import { normalizeIdentifier } from './normalize'

/**
 * Compute whether an email identifier belongs to the org. Returns true when
 * the address matches one of the active integration's own addresses
 * (`ctx.ownEmails`) OR sits on one of the organization's configured domains.
 * Returns false for non-email identifiers.
 *
 * `ctx.ownEmails` is checked first so single-mailbox orgs without
 * `Organization.domains` configured still recognize their own mailbox as
 * internal. The domain check is the broader, policy-level fallback and reuses
 * the per-batch `ownDomainsByOrg` cache to avoid repeated Redis reads.
 */
async function classifyIsInternal(
  ctx: IngestContext,
  identifier: string,
  identifierType: IdentifierType
): Promise<boolean> {
  if (identifierType !== IdentifierTypeEnum.EMAIL) return false
  if (ctx.ownEmails.has(identifier.toLowerCase())) return true
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

    // Capture pre-upsert state so we can detect column changes for
    // participant:updated emission. Cheap point-lookup on the unique index.
    const [previous] = await ctx.db
      .select({
        id: schema.Participant.id,
        name: schema.Participant.name,
        displayName: schema.Participant.displayName,
        hasReceivedMessage: schema.Participant.hasReceivedMessage,
        lastSentMessageAt: schema.Participant.lastSentMessageAt,
        isInternal: schema.Participant.isInternal,
      })
      .from(schema.Participant)
      .where(
        and(
          eq(schema.Participant.organizationId, ctx.organizationId),
          eq(schema.Participant.identifier, normalizedIdentifier),
          eq(schema.Participant.identifierType, identifierType)
        )
      )
      .limit(1)

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

    // Emit `participant:updated` only when this was an UPDATE (previous row
    // existed) AND at least one tracked column actually changed. New rows
    // don't get a `participant:created` event in v1 — the FE looks them up
    // on demand via `requestParticipant` when a message references them.
    if (previous) {
      const patch: Partial<ParticipantMeta> = {}
      if (participant.name !== previous.name) patch.name = participant.name
      if (participant.displayName !== previous.displayName) {
        patch.displayName = participant.displayName
      }
      if (participant.hasReceivedMessage !== previous.hasReceivedMessage) {
        patch.hasReceivedMessage = participant.hasReceivedMessage
      }
      const prevSent = previous.lastSentMessageAt?.getTime() ?? null
      const nextSent = participant.lastSentMessageAt?.getTime() ?? null
      if (prevSent !== nextSent) {
        patch.lastSentMessageAt = participant.lastSentMessageAt
          ? participant.lastSentMessageAt.toISOString()
          : null
      }
      if (participant.isInternal !== previous.isInternal) patch.isInternal = participant.isInternal

      if (Object.keys(patch).length > 0) {
        await publishParticipantUpdated(
          getRealtimeService(),
          ctx.organizationId,
          { participantId: participant.id, patch },
          { excludeSocketId: ctx.socketId }
        )
      }
    }

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
