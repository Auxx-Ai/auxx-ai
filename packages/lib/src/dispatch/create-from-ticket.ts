// packages/lib/src/dispatch/create-from-ticket.ts

import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { getOrgCache } from '../cache'
import { UnifiedCrudHandler } from '../resources/crud'
import type { CreateFromTicketInput } from './types'

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/**
 * Create a work order from a ticket (01 §8 SECONDARY intake path). Copies the ticket's
 * title/description/contact onto the new work order and links `work_order_ticket` back to
 * the source ticket. The ticket itself is never mutated.
 *
 * Events stay ON (user-triggered) — timeline, realtime `record:created`, the §F.4a number
 * pre-hook, and the visit auto-create hook (§H.1) all fire from `handler.create`. No direct
 * `ensureVisitForWorkOrder` call here — the field-change hook is the single creation door.
 *
 * @param input - organizationId, userId (acting user), ticketInstanceId (EntityInstance id)
 * @returns The created work order (`CreateEntityResult` shape from `UnifiedCrudHandler.create`)
 */
export async function createWorkOrderFromTicket(input: CreateFromTicketInput) {
  const { organizationId, userId, ticketInstanceId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const cache = getOrgCache()

  const ticketRecordId = toRecordId('ticket', ticketInstanceId)

  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'ticket_title',
      'ticket_description',
      'ticket_contact',
      'ticket_number',
    ] as const)

  const fieldIds = [cf.ticket_title, cf.ticket_description, cf.ticket_contact, cf.ticket_number]
    .filter(Boolean)
    .map((f) => f!.id)
  const ticketValues = await handler.getFieldValues(ticketRecordId, fieldIds)

  const titleTyped = cf.ticket_title ? firstTyped(ticketValues.get(cf.ticket_title.id)) : undefined
  const descriptionTyped = cf.ticket_description
    ? firstTyped(ticketValues.get(cf.ticket_description.id))
    : undefined
  const contactTyped = cf.ticket_contact
    ? firstTyped(ticketValues.get(cf.ticket_contact.id))
    : undefined
  const numberTyped = cf.ticket_number
    ? firstTyped(ticketValues.get(cf.ticket_number.id))
    : undefined

  const title = titleTyped ? (extractValue(titleTyped) as string) : undefined
  const description = descriptionTyped ? (extractValue(descriptionTyped) as string) : undefined
  const ticketNumber = numberTyped ? (extractValue(numberTyped) as string) : undefined
  const contactRecordId = contactTyped?.type === 'relationship' ? contactTyped.recordId : undefined

  const values: Record<string, unknown> = {
    work_order_title: title || `Work order for ${ticketNumber ?? ticketInstanceId}`,
    work_order_description: description,
    work_order_status: 'new',
    work_order_ticket: ticketRecordId,
  }

  if (contactRecordId) {
    values.work_order_contact = contactRecordId

    // Optional copy: the contact's own company, if it has one.
    const contactCf = await cache
      .from(organizationId, 'customFields')
      .bySystemAttributes(['contact_company'] as const)
    if (contactCf.contact_company) {
      const contactValues = await handler.getFieldValues(contactRecordId, [
        contactCf.contact_company.id,
      ])
      const companyTyped = firstTyped(contactValues.get(contactCf.contact_company.id))
      if (companyTyped?.type === 'relationship') {
        values.work_order_company = companyTyped.recordId
      }
    }
  }

  // Events ON (no skipEvents — user-triggered): timeline + realtime `record:created` +
  // the §F.4a number pre-hook + the visit auto-create hook all fire. Inverse sides
  // (contact_work_orders / ticket_work_orders) sync automatically from the RecordId values.
  return handler.create('work_order', values)
}
