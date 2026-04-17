// packages/lib/src/ingest/contacts/has-sent-to.ts

import { schema } from '@auxx/database'
import { ParticipantRole as ParticipantRoleEnum } from '@auxx/database/enums'
import { and, eq, inArray } from 'drizzle-orm'
import type { IngestContext } from '../context'

/**
 * True when the organization has previously sent a message to this participant.
 * Used by selective mode to decide whether an inbound-only participant should
 * become a contact.
 *
 * Resolution order:
 * 1. SelectiveModeCache (persists across batches during initial sync)
 * 2. Participant.hasReceivedMessage flag
 * 3. Fallback query on MessageParticipant (updates the flag + cache on hit)
 */
export async function hasOrganizationSentToParticipant(
  ctx: IngestContext,
  args: { participantId: string; identifier: string; organizationId: string }
): Promise<boolean> {
  const { participantId, identifier, organizationId } = args

  const cached = await ctx.selectiveCache.hasSentToRecipient(identifier, organizationId)
  if (cached) return true

  const [participant] = await ctx.db
    .select({ hasReceivedMessage: schema.Participant.hasReceivedMessage })
    .from(schema.Participant)
    .where(eq(schema.Participant.id, participantId))
    .limit(1)

  if (participant?.hasReceivedMessage) {
    await ctx.selectiveCache.markSentToRecipient(identifier, organizationId)
    return true
  }

  const [sentMessage] = await ctx.db
    .select({ id: schema.MessageParticipant.id })
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
    await ctx.db
      .update(schema.Participant)
      .set({
        hasReceivedMessage: true,
        lastSentMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.Participant.id, participantId))
    await ctx.selectiveCache.markSentToRecipient(identifier, organizationId)
    return true
  }

  return false
}
