// packages/lib/src/placeholders/context.ts

import { type Database, schema } from '@auxx/database'
import type { IdentifierType } from '@auxx/database/types'
import type { RecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { toRecordId } from '../resources/resource-id'
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
 * Look up the fields needed to resolve placeholders against a thread / ticket
 * / contact context. Runs the thread + participant lookups concurrently with
 * the entity-definition cache read. Missing rows are tolerated — the resolver
 * hard-fails per-token when it encounters one whose root isn't in
 * `recordIdsByRoot`.
 */
export async function buildPlaceholderContextForThread(
  input: BuildContextInput
): Promise<PlaceholderResolutionContext> {
  const { db, organizationId, senderUserId, threadId, primaryRecipient } = input

  const [thread, participant, entityDefs] = await Promise.all([
    threadId
      ? db
          .select({
            primaryEntityInstanceId: schema.Thread.primaryEntityInstanceId,
            primaryEntityDefinitionId: schema.Thread.primaryEntityDefinitionId,
          })
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
    getOrgCache().get(organizationId, 'entityDefs'),
  ])

  const primaryInstanceId = thread?.primaryEntityInstanceId ?? undefined
  const primaryDefinitionId = thread?.primaryEntityDefinitionId ?? undefined
  const contactEntityInstanceId = participant?.entityInstanceId ?? undefined

  const recordIdsByRoot = new Map<string, RecordId>()

  // Slug-rooted (old system types / actor)
  if (threadId) {
    recordIdsByRoot.set('thread', toRecordId('thread', threadId))
  }
  if (senderUserId) {
    recordIdsByRoot.set('user', toRecordId('user', senderUserId))
  }

  // Cuid-rooted EntityDefinitions — the picker emits tokens keyed by
  // `EntityDefinition.id`, not by entityType slug. The legacy ticket-only
  // shim continues to work whenever the primary entity happens to be a Ticket.
  if (primaryInstanceId && primaryDefinitionId) {
    recordIdsByRoot.set(primaryDefinitionId, toRecordId(primaryDefinitionId, primaryInstanceId))
    if (entityDefs.ticket && primaryDefinitionId === entityDefs.ticket) {
      recordIdsByRoot.set(entityDefs.ticket, toRecordId('ticket', primaryInstanceId))
    }
  }
  if (contactEntityInstanceId && entityDefs.contact) {
    recordIdsByRoot.set(entityDefs.contact, toRecordId('contact', contactEntityInstanceId))
  }

  return {
    db,
    organizationId,
    senderUserId,
    recordIdsByRoot,
  }
}
