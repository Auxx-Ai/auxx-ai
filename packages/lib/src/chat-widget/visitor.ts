// packages/lib/src/chat-widget/visitor.ts

import { type Database, schema } from '@auxx/database'
import type { ParticipantEntity } from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import { formatVisitorLabel } from '../chat/labels'
import { Result, type TypedResult } from '../result'

export interface FindOrCreateVisitorOptions {
  db: Database
  organizationId: string
  /** Stable visitor id — typically the `auxx_chat_session_id` cookie value. */
  sessionId: string
  /** Optional initial visitor name (from widget collect-info form). */
  name?: string | null
}

/**
 * Find (or create) the {@link schema.Participant} row that represents a
 * chat-widget visitor. Phase 4 expands this with email/phone lookups; for
 * Phase 2b we identify visitors by the sticky `sessionId` cookie alone.
 */
export async function findOrCreateVisitorParticipant(
  options: FindOrCreateVisitorOptions
): Promise<TypedResult<ParticipantEntity, Error>> {
  const { db, organizationId, sessionId, name } = options

  try {
    const existing = await db.query.Participant.findFirst({
      where: and(
        eq(schema.Participant.organizationId, organizationId),
        eq(schema.Participant.identifier, sessionId),
        eq(schema.Participant.identifierType, 'CHAT_VISITOR')
      ),
    })
    if (existing) return Result.ok(existing)

    const fallback = formatVisitorLabel(sessionId)
    const [created] = await db
      .insert(schema.Participant)
      .values({
        organizationId,
        identifier: sessionId,
        identifierType: 'CHAT_VISITOR',
        name: name ?? fallback,
        displayName: name ?? fallback,
        firstInteractionType: 'chat',
        firstInteractionDate: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    if (!created) return Result.error(new Error('Failed to create visitor participant'))
    return Result.ok(created)
  } catch (error) {
    return Result.error(error instanceof Error ? error : new Error(String(error)))
  }
}
