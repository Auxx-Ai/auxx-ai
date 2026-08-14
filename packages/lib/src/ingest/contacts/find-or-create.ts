// packages/lib/src/ingest/contacts/find-or-create.ts

import {
  IdentifierType as IdentifierTypeEnum,
  ParticipantRole as ParticipantRoleEnum,
} from '@auxx/database/enums'
import type { ParticipantEntity as Participant, ParticipantRole } from '@auxx/database/types'
import { formatPhoneNumber } from '@auxx/utils'
import { linkContactToCompanyByDomain } from '../companies/link-contact'
import type { IngestContext } from '../context'
import { getOwnDomains } from '../domain/classifier'
import { getNamesFromParticipant } from '../participants/display'
import { hasOrganizationSentToParticipant } from './has-sent-to'

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

    // Chat-widget visitors are identified by an opaque session id (cookie value),
    // not an email/phone — `Participant.identifier` is a cuid, not addressable.
    // The other identifier types all carry a real address we can use as a dedupe
    // key on the contact (`primary_email` / `phone`); chat visitors don't, so we
    // skip the identifier-keyed lookup and rely on `Participant.entityInstanceId`
    // for dedupe on the caller side.
    const isChatVisitor = participant.identifierType === 'CHAT_VISITOR'

    // A PHONE participant is not guaranteed to carry a dialable number: SMS
    // short codes (`12345`) and alphanumeric sender IDs (`AUXX`) arrive with
    // the same identifier type. The write validator normalizes to E.164 and
    // REJECTS those, so writing one would throw inside ingest. Treat them like
    // chat visitors — no phone value, no identifier-keyed dedupe.
    const isAddressablePhone =
      participant.identifierType !== IdentifierTypeEnum.PHONE ||
      formatPhoneNumber(participant.identifier) !== null

    if (!isAddressablePhone) {
      ctx.logger.debug('Participant phone identifier is not a dialable number', {
        participantId: participant.id,
        identifier: participant.identifier,
      })
    }

    const systemAttr =
      isChatVisitor || !isAddressablePhone
        ? null
        : participant.identifierType === IdentifierTypeEnum.PHONE
          ? 'phone'
          : 'primary_email'

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
      if (!systemAttr) return null
      const existing = await handler.findByField('contact', systemAttr, participant.identifier)
      return existing?.id ?? null
    }

    if (!force && mode === 'selective' && messageContext) {
      if (systemAttr) {
        const existing = await handler.findByField('contact', systemAttr, participant.identifier)
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

    if (participant.identifierType === IdentifierTypeEnum.PHONE && isAddressablePhone) {
      // Array-wrapped for shape consistency with multi-value fields
      // (options.multi) — the write path auto-unwraps length-1 arrays on
      // single-value fields. Create-only: matched contacts never get their
      // identifier re-written here (no-append is the locked ingest decision).
      createValues.phone = [participant.identifier]
    }

    let contactId: string
    if (isChatVisitor || !systemAttr) {
      // No identifier-keyed dedupe — just create. The caller writes the new id
      // back to `Participant.entityInstanceId`, which is the only stable dedupe
      // key we have for chat visitors.
      const { instance } = await handler.create('contact', createValues)
      contactId = instance.id
    } else {
      // `findBy` stays scalar (it drives the lookup); the create data gets the
      // array-wrapped identifier so a fresh contact's email/phone lands in the
      // multi-value shape (createValues spreads after findBy in findOrCreate).
      const findBy: Record<string, unknown> = { [systemAttr]: participant.identifier }
      const { instance } = await handler.findOrCreate('contact', findBy, {
        ...createValues,
        [systemAttr]: [participant.identifier],
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
