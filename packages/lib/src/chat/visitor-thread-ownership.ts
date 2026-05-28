// packages/lib/src/chat/visitor-thread-ownership.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { aliasedTable, and, eq, exists, or, type SQL, sql } from 'drizzle-orm'

/**
 * Build the ownership predicate that gates every visitor → Thread read in the
 * chat widget routes. A thread is "owned" by the caller when ANY of:
 *
 *  1. The thread has at least one inbound Message whose `fromId` Participant is
 *     the caller's current session-keyed Participant.
 *  2. When the passport carries a verified Contact, any inbound Message's
 *     Participant has `entityInstanceId = contactId` (cross-device follow).
 *  3. The thread was just created by the caller and has no messages yet —
 *     matched via the creator-recorded `metadata.visitorParticipantId`. Without
 *     this leg, `POST /threads` → `POST /pusher/auth` and `POST /threads` →
 *     `POST /initialize` race against the empty-thread state.
 *
 * Pass `useAliases: true` when the outer query already references
 * `schema.Message` / `schema.Participant` (currently only the attachments
 * route). The inner EXISTS then uses aliased copies so Drizzle doesn't conflate
 * the inner and outer joins.
 *
 * Callers MUST reference `schema.Thread` in their outer FROM/JOIN — the inner
 * EXISTS correlates on `schema.Thread.id` and metadata.
 */
export function buildVisitorThreadOwnership(args: {
  db: Database
  visitorParticipantId: string
  contactId: string | undefined
  useAliases?: boolean
}): SQL {
  const Message = args.useAliases ? aliasedTable(schema.Message, 'vto_m') : schema.Message
  const Participant = args.useAliases
    ? aliasedTable(schema.Participant, 'vto_p')
    : schema.Participant

  const ownershipMatch = args.contactId
    ? or(
        eq(Participant.id, args.visitorParticipantId),
        eq(Participant.entityInstanceId, args.contactId)
      )
    : eq(Participant.id, args.visitorParticipantId)

  const messageOwnership = exists(
    args.db
      .select({ x: sql`1` })
      .from(Message)
      .innerJoin(Participant, eq(Participant.id, Message.fromId))
      .where(
        and(eq(Message.threadId, schema.Thread.id), eq(Message.isInbound, true), ownershipMatch)
      )
  )

  return or(
    messageOwnership,
    sql`${schema.Thread.metadata}->>'visitorParticipantId' = ${args.visitorParticipantId}`
  ) as SQL
}
