// packages/lib/src/ingest/contacts/create-after-outbound.ts

import { schema } from '@auxx/database'
import { ParticipantRole as ParticipantRoleEnum } from '@auxx/database/enums'
import { eq } from 'drizzle-orm'
import type { IngestContext } from '../context'
import { findOrCreateContactForParticipant } from './find-or-create'

/**
 * Retroactively attach a contact to a participant the first time we send
 * them a message. No-op if the participant already has `entityInstanceId`
 * or isn't found.
 */
export async function createContactAfterOutboundMessage(
  ctx: IngestContext,
  participantId: string
): Promise<void> {
  try {
    const [participant] = await ctx.db
      .select()
      .from(schema.Participant)
      .where(eq(schema.Participant.id, participantId))
      .limit(1)

    if (!participant) {
      ctx.logger.warn(`Participant ${participantId} not found for retroactive contact creation`)
      return
    }

    if (participant.entityInstanceId) return

    const entityInstanceId = await findOrCreateContactForParticipant(ctx, participant, {
      isInbound: false,
      role: ParticipantRoleEnum.TO,
    })

    if (entityInstanceId) {
      await ctx.db
        .update(schema.Participant)
        .set({
          entityInstanceId,
          hasReceivedMessage: true,
          lastSentMessageAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.Participant.id, participantId))

      ctx.logger.info(
        `Created retroactive contact ${entityInstanceId} for participant ${participantId}`
      )
    }
  } catch (error) {
    ctx.logger.error('Error creating retroactive contact:', {
      error,
      participantId,
      organizationId: ctx.organizationId,
    })
  }
}
