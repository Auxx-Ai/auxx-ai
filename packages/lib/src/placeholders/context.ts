// packages/lib/src/placeholders/context.ts

import { type Database, schema } from '@auxx/database'
import type { IdentifierType } from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import type { PlaceholderResolutionContext } from './resolver'

export interface BuildContextInput {
  db: Database
  organizationId: string
  senderUserId: string
  threadId?: string
  /**
   * Email / phone / etc. of the primary recipient — used to look up the
   * matching Participant row and its linked contact EntityInstance.
   * Optional: if omitted, contact-rooted placeholders become unresolvable.
   */
  primaryRecipient?: {
    identifier: string
    identifierType: IdentifierType
  }
}

/**
 * Look up the fields needed to resolve placeholders against a thread/ticket/
 * contact context. Runs two concurrent queries (thread record + primary
 * participant). Missing rows are tolerated — the resolver hard-fails per-
 * token when it encounters one whose context it needs.
 */
export async function buildPlaceholderContextForThread(
  input: BuildContextInput
): Promise<PlaceholderResolutionContext> {
  const { db, organizationId, senderUserId, threadId, primaryRecipient } = input

  const [thread, participant] = await Promise.all([
    threadId
      ? db
          .select({ ticketId: schema.Thread.ticketId })
          .from(schema.Thread)
          .where(
            and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId))
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    primaryRecipient
      ? db
          .select({ entityInstanceId: schema.Participant.entityInstanceId })
          .from(schema.Participant)
          .where(
            and(
              eq(schema.Participant.organizationId, organizationId),
              eq(schema.Participant.identifier, primaryRecipient.identifier),
              eq(schema.Participant.identifierType, primaryRecipient.identifierType)
            )
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ])

  return {
    db,
    organizationId,
    senderUserId,
    threadId,
    ticketId: thread?.ticketId ?? undefined,
    contactEntityInstanceId: participant?.entityInstanceId ?? undefined,
  }
}
