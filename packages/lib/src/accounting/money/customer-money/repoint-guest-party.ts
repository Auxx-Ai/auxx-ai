// packages/lib/src/accounting/money/customer-money/repoint-guest-party.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { getOrganizationSetting } from '../../../settings/settings-service'
import { GUEST_CONTACT_SETTING_KEY } from '../../parties'

/**
 * Give every receipt applied to these orders while the order still named the guest
 * the customer the order names now. A synced order arrives on the guest and is
 * repointed by the connector's relationship pass, after its receipts were ingested
 * and accepted, so nothing else revisits their party. The posted entry keeps the
 * guest as its frozen line counterparty (91 §8.6). Returns the movements repointed.
 */
export async function repointGuestReceiptsForOrders(
  db: Database | Transaction,
  organizationId: string,
  orderInstanceIds: readonly string[]
): Promise<number> {
  const ids = [...new Set(orderInstanceIds)]
  if (!ids.length) return 0
  const guestId = await getOrganizationSetting({
    organizationId,
    key: GUEST_CONTACT_SETTING_KEY,
    db,
  })
  if (!guestId) return 0

  const money = schema.MoneyTransaction
  const application = schema.MoneyApplication
  const contact = schema.FieldValue
  const field = schema.CustomField
  const rows = await db
    .select({ moneyTransactionId: money.id, contactId: contact.relatedEntityId })
    .from(application)
    .innerJoin(money, eq(money.id, application.moneyTransactionId))
    .innerJoin(
      contact,
      and(
        eq(contact.organizationId, application.organizationId),
        eq(contact.entityId, application.orderInstanceId)
      )
    )
    .innerJoin(
      field,
      and(eq(field.id, contact.fieldId), eq(field.systemAttribute, 'order_contact'))
    )
    .where(
      and(
        eq(application.organizationId, organizationId),
        eq(application.operation, 'apply'),
        inArray(application.orderInstanceId, ids),
        eq(money.partyInstanceId, guestId),
        isNotNull(contact.relatedEntityId),
        ne(contact.relatedEntityId, guestId)
      )
    )

  const byContact = new Map<string, string[]>()
  for (const row of rows) {
    const list = byContact.get(row.contactId!) ?? []
    list.push(row.moneyTransactionId)
    byContact.set(row.contactId!, list)
  }
  for (const [contactId, moneyIds] of byContact) {
    await db
      .update(money)
      .set({ partyInstanceId: contactId })
      .where(and(eq(money.organizationId, organizationId), inArray(money.id, moneyIds)))
  }
  return rows.length
}
