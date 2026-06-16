// packages/lib/src/participants/participant-queries.ts

import { type Database, database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { resolveChatAttributes } from '../chat/attribute-resolution'
import { getChatThreadMetadata } from '../chat/metadata'
import { BadRequestError, NotFoundError } from '../errors'
import {
  createIngestContext,
  extractRegistrableDomain,
  findOrCreateContactForParticipant,
  getOwnDomains,
  type IngestContext,
  normalizeDomain,
} from '../ingest'

const logger = createScopedLogger('participant-queries')

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
  options: { allowOwnDomain?: boolean; sourceThreadId?: string } = {}
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

  // Copy the visitor's claimed name/email + last-known geo from the source chat
  // thread onto the freshly created contact. Best-effort — the contact is
  // already created/linked, so a copy failure must never fail the promotion.
  if (options.sourceThreadId) {
    await copyChatAttributesToContact(
      ingestCtx,
      { db, organizationId },
      options.sourceThreadId,
      entityInstanceId
    )
  }

  return { entityInstanceId, created: true }
}

/**
 * Project a chat thread's claimed identity + last-known geo onto a contact.
 * Reuses the same `resolveChatAttributes` mapping the JWT path uses (name-split
 * into first/last, geo passthrough). Best-effort: logs and swallows on failure.
 */
async function copyChatAttributesToContact(
  ingestCtx: IngestContext,
  serviceCtx: { db: Database; organizationId: string },
  sourceThreadId: string,
  entityInstanceId: string
): Promise<void> {
  try {
    const meta = await getChatThreadMetadata(serviceCtx, sourceThreadId)
    if (!meta) return

    const { writes } = resolveChatAttributes({
      bootAttributes: {
        name: meta.claimedVisitorName,
        city: meta.visit?.city,
        region: meta.visit?.region,
        country: meta.visit?.country,
        timezone: meta.visit?.timezone,
      },
    })

    const attrs: Record<string, unknown> = {
      ...writes, // { first_name?, last_name?, city?, region?, country?, timezone? }
      ...(meta.claimedVisitorEmail ? { primary_email: meta.claimedVisitorEmail } : {}),
    }

    // Drop empties so we never overwrite with blank values.
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === '') delete attrs[key]
    }

    if (Object.keys(attrs).length === 0) return

    await ingestCtx.crudHandler.update(toRecordId('contact', entityInstanceId), attrs)
  } catch (err) {
    logger.warn('Failed to copy chat attributes to new contact', {
      sourceThreadId,
      entityInstanceId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
