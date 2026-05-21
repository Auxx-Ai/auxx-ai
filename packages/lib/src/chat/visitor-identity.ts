// packages/lib/src/chat/visitor-identity.ts

import { schema } from '@auxx/database'
import type { ParticipantEntity } from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import { BadRequestError } from '../errors'
import { Result, type TypedResult } from '../result'
import type { ServiceContext } from './types'

/**
 * Find or create the {@link schema.Participant} row representing a chat-widget
 * visitor. Visitors are identified by their sticky `auxx_chat_session_id`
 * cookie value, stored as `Participant.identifier` with type `CHAT_VISITOR`.
 *
 * Phase 4 wrapper around the existing `chat-widget/visitor` helper — kept here
 * so the new chat service module is self-contained.
 */
export async function findOrCreateVisitorParticipant(
  ctx: ServiceContext,
  visitorId: string,
  opts?: { displayName?: string }
): Promise<TypedResult<ParticipantEntity, Error>> {
  if (!visitorId) {
    return Result.error(new BadRequestError('visitorId is required'))
  }

  try {
    const existing = await ctx.db.query.Participant.findFirst({
      where: and(
        eq(schema.Participant.organizationId, ctx.organizationId),
        eq(schema.Participant.identifier, visitorId),
        eq(schema.Participant.identifierType, 'CHAT_VISITOR')
      ),
    })
    if (existing) {
      return Result.ok(existing)
    }

    const [created] = await ctx.db
      .insert(schema.Participant)
      .values({
        organizationId: ctx.organizationId,
        identifier: visitorId,
        identifierType: 'CHAT_VISITOR',
        name: opts?.displayName ?? null,
        displayName: opts?.displayName ?? null,
        firstInteractionType: 'chat',
        firstInteractionDate: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    if (!created) {
      return Result.error(new Error('Failed to create visitor participant'))
    }
    return Result.ok(created)
  } catch (error) {
    return Result.error(error instanceof Error ? error : new Error(String(error)))
  }
}
