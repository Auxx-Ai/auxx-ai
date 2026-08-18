// packages/lib/src/ingest/contacts/find-or-create.ts

import {
  IdentifierType as IdentifierTypeEnum,
  ParticipantRole as ParticipantRoleEnum,
} from '@auxx/database/enums'
import type { ParticipantEntity as Participant, ParticipantRole } from '@auxx/database/types'
import { linkContactToCompanyByDomain } from '../companies/link-contact'
import type { IngestContext } from '../context'
import { getOwnDomains } from '../domain/classifier'
import { getNamesFromParticipant } from '../participants/display'
import { hasOrganizationSentToParticipant } from './has-sent-to'
import { contactIdentityCandidate } from './identity-candidate'

/** Roles that make a participant a recipient of an outbound message. */
const OUTBOUND_RECIPIENT_ROLES: readonly ParticipantRole[] = [
  ParticipantRoleEnum.TO,
  ParticipantRoleEnum.CC,
  ParticipantRoleEnum.BCC,
]

/**
 * Find (or create, depending on integration record-creation mode) a contact
 * EntityInstance for a participant. Uses UnifiedCrudHandler for the underlying
 * EntityInstance + FieldValue writes — callers must not bypass it.
 *
 * Modes:
 * - `'none'`: lookup only
 * - `'selective'` (default): create if outbound recipient OR org has previously
 *   sent to this participant; otherwise skip
 * - `'all'`: always find-or-create
 *
 * Pass `options.force = true` to bypass mode gating entirely (always
 * find-or-create). Used by the user-initiated "create ticket from thread" flow
 * where the click itself is the explicit intent.
 *
 * Pass `options.skipCreation = true` for hard-tier machine mail (bounces/NDRs):
 * this returns `null` without touching the contact graph, so a daemon sender
 * never becomes a Contact (which would fire `contact:created` automations — the
 * transitive backscatter loop).
 *
 * When a contact is created (or matched), this also auto-links the contact
 * to a company keyed by email domain. Linking failures are swallowed and
 * logged — contact creation must succeed regardless.
 */
export async function findOrCreateContactForParticipant(
  ctx: IngestContext,
  participant: Participant,
  messageContext?: { isInbound: boolean; role: ParticipantRole },
  options?: { force?: boolean; skipCreation?: boolean }
): Promise<string | null> {
  try {
    if (options?.skipCreation) {
      ctx.logger.debug('Skipping contact creation for hard-tier machine mail participant', {
        participantId: participant.id,
        identifier: participant.identifier,
      })
      return null
    }

    const mode = ctx.integrationSettings?.recordCreation?.mode || 'selective'
    const handler = ctx.crudHandler
    const force = options?.force ?? false

    // Which contact attribute this identifier dedupes on — `primary_email`,
    // `phone`, or the `RecordIdentity` index via `external_id`. See
    // `contactIdentityCandidate` for why the mapping is per-type and what a
    // `null` costs. Social ids (PSID/IGSID) resolve to a namespaced
    // `external_id` (`"facebook:123…"`), which is an index row, not a cell.
    const identity = contactIdentityCandidate(participant)

    if (!identity && participant.identifierType === IdentifierTypeEnum.PHONE) {
      ctx.logger.debug('Participant phone identifier is not a dialable number', {
        participantId: participant.id,
        identifier: participant.identifier,
      })
    }

    // Never auto-create a contact for the integration owner's own addresses.
    // `force` is the documented escape hatch for the user-initiated
    // "create ticket from thread" flow where the click itself is the explicit
    // intent.
    if (!force && participant.isInternal) {
      ctx.logger.info(
        `Skipping contact creation for internal participant ${participant.id} (${participant.identifier})`
      )
      return null
    }

    if (!force && mode === 'none') {
      if (!identity) return null
      const existing = await handler.findByField(
        'contact',
        identity.systemAttribute,
        identity.value
      )
      return existing?.id ?? null
    }

    if (!force && mode === 'selective' && messageContext) {
      if (identity) {
        const existing = await handler.findByField(
          'contact',
          identity.systemAttribute,
          identity.value
        )
        if (existing) return existing.id
      }

      const isOutboundRecipient =
        !messageContext.isInbound && OUTBOUND_RECIPIENT_ROLES.includes(messageContext.role)

      if (!isOutboundRecipient) {
        const hasSentBefore = await hasOrganizationSentToParticipant(ctx, {
          participantId: participant.id,
          identifier: participant.identifier,
          organizationId: ctx.organizationId,
        })
        if (!hasSentBefore) {
          ctx.logger.info(
            `Skipping contact creation for inbound-only participant ${participant.id} (selective mode)`
          )
          return null
        }
      }
    }

    const names = getNamesFromParticipant(participant)
    const createValues: Record<string, unknown> = {
      first_name: names.firstName,
      last_name: names.lastName,
      contact_status: 'ACTIVE',
    }

    let contactId: string
    if (!identity) {
      // No identifier-keyed dedupe — just create. The caller writes the new id
      // back to `Participant.entityInstanceId`, which is then the only dedupe
      // key: a chat visitor's session cuid and an SMS short code are not
      // identities anyone else issues.
      const { instance } = await handler.create('contact', createValues)
      contactId = instance.id
    } else {
      // `findBy` stays scalar (it drives the lookup); the create data gets the
      // array-wrapped identifier so a fresh contact's email/phone lands in the
      // multi-value shape (createValues spreads after findBy in findOrCreate).
      // For `external_id` the array form is load-bearing rather than cosmetic:
      // `UnifiedCrudHandler.create` peels an ARRAY-valued `external_id` off and
      // mirrors each entry into `RecordIdentity`; a scalar would fall through to
      // the FieldValue writer for an attribute that no longer exists as a cell.
      const findBy: Record<string, unknown> = { [identity.systemAttribute]: identity.value }
      const { instance } = await handler.findOrCreate('contact', findBy, {
        ...createValues,
        [identity.systemAttribute]: [identity.value],
      })
      contactId = instance.id
    }

    if (contactId) {
      const ownDomains = await resolveOwnDomains(ctx, ctx.organizationId)
      await linkContactToCompanyByDomain({
        organizationId: ctx.organizationId,
        crudHandler: handler,
        contactId,
        identifier: participant.identifier,
        identifierType: participant.identifierType,
        companyIdByDomain: ctx.companyIdByDomain,
        ownDomains,
        db: ctx.db,
      })
    }

    return contactId
  } catch (error) {
    ctx.logger.error('Error finding/creating contact for participant:', {
      error,
      participantId: participant.id,
    })
    throw error
  }
}

/** Per-batch cached fetch of the org's own-domains set. */
async function resolveOwnDomains(ctx: IngestContext, organizationId: string): Promise<Set<string>> {
  const cached = ctx.ownDomainsByOrg.get(organizationId)
  if (cached) return cached
  const set = await getOwnDomains(organizationId)
  ctx.ownDomainsByOrg.set(organizationId, set)
  return set
}
