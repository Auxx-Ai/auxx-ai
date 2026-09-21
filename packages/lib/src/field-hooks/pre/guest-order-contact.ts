// packages/lib/src/field-hooks/pre/guest-order-contact.ts

import { database, schema } from '@auxx/database'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { GUEST_CONTACT_SETTING_KEY } from '../../accounting/parties'
import { getOrgCache } from '../../cache'
import { ForbiddenError } from '../../errors'
import { getOrganizationSetting } from '../../settings'
import type { EntityPreCreateHandler, EntityPreDeleteHandler } from '../types'

const CONTACT_ATTR = 'order_contact'
const COMPANY_ATTR = 'order_company'
const MEMO_CONTACT_ATTR = 'credit_memo_contact'
const MEMO_ORDER_ATTR = 'credit_memo_order'

/**
 * Name the org's guest customer on an order that arrives with neither a contact
 * nor a company (task 79 §4.1), so "every order has a customer" is total and no
 * downstream reader — the ingest, the poster, aging, the export — needs a guest
 * case. An org that never provisioned accounting has no guest id and is untouched.
 *
 * A PRE-CREATE hook because `event.values` is the object `createEntity` hands to
 * `setFieldValues` next, so the contact lands in the same write as the order and
 * no order ever exists customerless. A later sync attaching a real customer just
 * overwrites it.
 */
export const fillGuestOrderContact: EntityPreCreateHandler = async (event) => {
  const { organizationId, values } = event

  // Cheapest exit first: an org that never provisioned accounting has no guest
  // and must not pay a `customFields` lookup on every order create.
  const guestId = await getOrganizationSetting({
    organizationId,
    key: GUEST_CONTACT_SETTING_KEY,
  })
  if (!guestId) return

  // 🛑 `values` may be keyed by field id (the connector sink writes that way) or
  // by systemAttribute, so both spellings of both legs have to be read.
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([CONTACT_ATTR, COMPANY_ATTR] as const)
  const contactKeys = [CONTACT_ATTR, fields.order_contact?.id]
  const companyKeys = [COMPANY_ATTR, fields.order_company?.id]
  if ([...contactKeys, ...companyKeys].some((key) => key && !isBlank(values[key]))) return

  values[CONTACT_ATTR] = toRecordId('contact', guestId)
}

/**
 * The same stand-in for a credit memo (task 79, after G5). The Shopify connector
 * binds `credit_memo_contact` from `refunds[].customerId` and clears the
 * reference on a guest checkout, leaving the refund ingest's customer leg
 * unsatisfiable; its own comment defers that to "the reviewer picks the
 * contact", which nobody does at four hundred memos.
 *
 * Prefers the ORDER's contact over the guest: a memo belongs to whoever its
 * order does, so this also covers a contactless memo on a real customer.
 */
export const fillGuestCreditMemoContact: EntityPreCreateHandler = async (event) => {
  const { organizationId, values } = event

  const guestId = await getOrganizationSetting({
    organizationId,
    key: GUEST_CONTACT_SETTING_KEY,
  })
  if (!guestId) return

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([MEMO_CONTACT_ATTR, MEMO_ORDER_ATTR, CONTACT_ATTR] as const)
  const contactKeys = [MEMO_CONTACT_ATTR, fields.credit_memo_contact?.id]
  if (contactKeys.some((key) => key && !isBlank(values[key]))) return

  const orderRef = [MEMO_ORDER_ATTR, fields.credit_memo_order?.id]
    .map((key) => (key ? values[key] : undefined))
    .find((raw) => !isBlank(raw))
  const orderContactFieldId = fields.order_contact?.id
  const orderId = relatedInstanceId(orderRef)
  const inherited =
    orderId && orderContactFieldId
      ? await readRelated(organizationId, orderId, orderContactFieldId)
      : null

  values[MEMO_CONTACT_ATTR] = toRecordId('contact', inherited ?? guestId)
}

/**
 * Refuse deleting the guest customer. One hook covers `deleteEntity` and
 * `bulkDeleteEntities` — they share `deleteRecords`, which resolves hooks per
 * definition.
 */
export const guardGuestContactDelete: EntityPreDeleteHandler = async (event) => {
  const guestId = await getOrganizationSetting({
    organizationId: event.organizationId,
    key: GUEST_CONTACT_SETTING_KEY,
  })
  if (!guestId) return
  if (parseRecordId(event.recordId).entityInstanceId !== guestId) return
  throw new ForbiddenError(
    'The guest customer is a system record: every order placed without a customer names it, and its money transactions would be stranded.',
    { organizationId: event.organizationId, contactInstanceId: guestId }
  )
}

/** A relationship value arrives pre-coercion: a RecordId, an envelope, an array, or absent. */
function isBlank(raw: unknown): boolean {
  if (raw == null) return true
  if (typeof raw === 'string') return raw.trim().length === 0
  if (Array.isArray(raw)) return raw.length === 0
  return false
}

/** The instance id behind a relationship value, when it is a plain RecordId. */
function relatedInstanceId(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.includes(':')) return null
  try {
    return parseRecordId(raw as never).entityInstanceId
  } catch {
    return null
  }
}

async function readRelated(
  organizationId: string,
  entityId: string,
  fieldId: string
): Promise<string | null> {
  const [row] = await database
    .select({ related: schema.FieldValue.relatedEntityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, entityId),
        eq(schema.FieldValue.fieldId, fieldId)
      )
    )
    .limit(1)
  return row?.related ?? null
}
