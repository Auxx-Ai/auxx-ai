// packages/lib/src/participants/participant-queries.ts

import { type Database, database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { BadRequestError, NotFoundError } from '../errors'
import {
  createIngestContext,
  extractRegistrableDomain,
  findOrCreateContactForParticipant,
  getOwnDomains,
  normalizeDomain,
} from '../ingest'

/** Result of `ensureContactForParticipant`. */
export interface EnsureContactResult {
  /** The contact EntityInstance id linked to the participant. */
  entityInstanceId: string
  /** True when this call performed the create; false when the participant was already linked. */
  created: boolean
}

/**
 * Idempotently ensure that a Participant has a linked contact EntityInstance.
 *
 * Resolution order:
 * 1. If `Participant.entityInstanceId` is already set → return it (no writes).
 * 2. If the participant is flagged spammer → throw `BadRequestError`.
 * 3. If the participant's email is on the org's own domains and `allowOwnDomain`
 *    is not set → throw `BadRequestError`. Live `getOwnDomains` lookup, so this
 *    catches stale `Participant.isInternal` flags after a domain change.
 * 4. Otherwise force-create a contact via `findOrCreateContactForParticipant`
 *    (bypassing selective-mode gating), write the new id back to
 *    `Participant.entityInstanceId`, and return it.
 *
 * Throws `NotFoundError` when the participant doesn't belong to `organizationId`.
 */
export async function ensureContactForParticipant(
  organizationId: string,
  participantId: string,
  db: Database = database,
  options: { allowOwnDomain?: boolean } = {}
): Promise<EnsureContactResult> {
  const [participant] = await db
    .select()
    .from(schema.Participant)
    .where(
      and(
        eq(schema.Participant.id, participantId),
        eq(schema.Participant.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!participant) throw new NotFoundError('Participant not found')

  if (participant.entityInstanceId) {
    return { entityInstanceId: participant.entityInstanceId, created: false }
  }

  if (participant.isSpammer) {
    throw new BadRequestError('Cannot create contact from spammer participant')
  }

  if (!options.allowOwnDomain && participant.identifierType === 'EMAIL') {
    const domain = extractRegistrableDomain(participant.identifier)
    if (domain) {
      const ownDomains = await getOwnDomains(organizationId)
      if (ownDomains.has(normalizeDomain(domain))) {
        throw new BadRequestError('Cannot create contact for an internal participant (own domain)')
      }
    }
  }

  const ingestCtx = await createIngestContext(organizationId, { db })
  const entityInstanceId = await findOrCreateContactForParticipant(
    ingestCtx,
    participant,
    undefined,
    { force: true }
  )
  if (!entityInstanceId) {
    throw new Error('Contact creation returned null')
  }

  await db
    .update(schema.Participant)
    .set({ entityInstanceId, updatedAt: new Date() })
    .where(eq(schema.Participant.id, participantId))

  return { entityInstanceId, created: true }
}
