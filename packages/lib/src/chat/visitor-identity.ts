// packages/lib/src/chat/visitor-identity.ts

import { schema } from '@auxx/database'
import type { ParticipantEntity } from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import { BadRequestError } from '../errors'
import type { GeoLocation } from '../geo'
import { Result, type TypedResult } from '../result'
import type { ServiceContext } from './types'
import { generateVisitorName } from './visitor-naming'

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
  opts?: { displayName?: string; geo?: GeoLocation | null }
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

    const fallback = generateVisitorName(visitorId, opts?.geo?.city)
    const [created] = await ctx.db
      .insert(schema.Participant)
      .values({
        organizationId: ctx.organizationId,
        identifier: visitorId,
        identifierType: 'CHAT_VISITOR',
        name: opts?.displayName ?? fallback,
        displayName: opts?.displayName ?? fallback,
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

/**
 * Update a chat visitor's Participant row when the widget supplies a claimed
 * identity (name/email). Overwrites the synthetic `Chat user #xxxx` label
 * baked in at create time so message headers and threads start showing the
 * real name. No-op if neither field is provided.
 */
export async function updateVisitorClaimedIdentity(
  ctx: ServiceContext,
  visitorParticipantId: string,
  opts: { name?: string; email?: string }
): Promise<TypedResult<undefined, Error>> {
  const trimmedName = opts.name?.trim()
  const trimmedEmail = opts.email?.trim()
  if (!trimmedName && !trimmedEmail) return Result.nil()

  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (trimmedName) {
      updates.name = trimmedName
      updates.displayName = trimmedName
    } else if (trimmedEmail) {
      // No name yet — fall back to email so the FROM stops showing the synthetic.
      updates.displayName = trimmedEmail
    }

    await ctx.db
      .update(schema.Participant)
      .set(updates)
      .where(
        and(
          eq(schema.Participant.id, visitorParticipantId),
          eq(schema.Participant.organizationId, ctx.organizationId),
          eq(schema.Participant.identifierType, 'CHAT_VISITOR')
        )
      )
    return Result.nil()
  } catch (error) {
    return Result.error(error instanceof Error ? error : new Error(String(error)))
  }
}
