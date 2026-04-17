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
 * When a contact is created (or matched), this also auto-links the contact
 * to a company keyed by email domain. Linking failures are swallowed and
 * logged — contact creation must succeed regardless.
 */
export async function findOrCreateContactForParticipant(
  ctx: IngestContext,
  participant: Participant,
  messageContext?: { isInbound: boolean; role: ParticipantRole }
): Promise<string | null> {
  try {
    const mode = ctx.integrationSettings?.recordCreation?.mode || 'selective'
    const handler = ctx.crudHandler

    const systemAttr =
      participant.identifierType === IdentifierTypeEnum.PHONE ? 'phone' : 'primary_email'

    if (mode === 'none') {
      const existing = await handler.findByField('contact', systemAttr, participant.identifier)
      return existing?.id ?? null
    }

    if (mode === 'selective' && messageContext) {
      const existing = await handler.findByField('contact', systemAttr, participant.identifier)
      if (existing) return existing.id

      const isOutboundRecipient =
        !messageContext.isInbound &&
        [ParticipantRoleEnum.TO, ParticipantRoleEnum.CC, ParticipantRoleEnum.BCC].includes(
          messageContext.role
        )

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
    const findBy: Record<string, unknown> = { [systemAttr]: participant.identifier }
    const createValues: Record<string, unknown> = {
      first_name: names.firstName,
      last_name: names.lastName,
      contact_status: 'ACTIVE',
    }

    if (participant.identifierType === IdentifierTypeEnum.PHONE) {
      createValues.phone = participant.identifier
    }

    const { instance } = await handler.findOrCreate('contact', findBy, createValues)
    const contactId = instance.id

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
