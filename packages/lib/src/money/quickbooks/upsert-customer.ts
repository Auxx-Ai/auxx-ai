// packages/lib/src/money/quickbooks/upsert-customer.ts

import { toRecordId } from '@auxx/types/resource'
import type { UnifiedCrudHandler } from '../../resources/crud'
import { readQuickbooksIdField, writeQuickbooksIdField } from './identity-field'
import type { QuickbooksToolContext } from './invoke-quickbooks-tool'

const QBO_CUSTOMER_ID_FIELD_KEY = 'qboCustomerId'

export interface UpsertQuickbooksCustomerInput {
  organizationId: string
  contactInstanceId: string
  contactFields: {
    firstName?: string
    lastName?: string
    primaryEmail?: string
  }
  handler: UnifiedCrudHandler
}

/**
 * Find-or-create the QuickBooks `Customer` mapped to an Auxx contact (money plan
 * 37e-quickbooks-invoice-sync.md §3 step 2, decision D4). Resolution order:
 *
 * 1. Stored `qboCustomerId` id-map field on the contact — the fast, idempotent path.
 * 2. `find_quickbooks_customer` by the contact's exact primary email — avoids the category's
 *    #1 pain (Jobber: duplicate customers from name matching); only attempted when the
 *    contact has an email.
 * 3. `create_quickbooks_customer`.
 *
 * The resolved id is always written back (field + `RecordIdentity` mirror), even when found
 * rather than created, so step 1 short-circuits on the next sync.
 */
export async function upsertQuickbooksCustomer(
  ctx: QuickbooksToolContext,
  input: UpsertQuickbooksCustomerInput
): Promise<string> {
  const { organizationId, contactInstanceId, contactFields, handler } = input
  const contactRecordId = toRecordId('contact', contactInstanceId)

  const stored = await readQuickbooksIdField({
    organizationId,
    installationId: ctx.installationId,
    connectionId: ctx.connectionId,
    appFieldKey: QBO_CUSTOMER_ID_FIELD_KEY,
    recordId: contactRecordId,
    handler,
  })
  if (stored) return stored

  const email = contactFields.primaryEmail?.trim() || undefined
  const displayName =
    [contactFields.firstName, contactFields.lastName].filter(Boolean).join(' ').trim() || undefined

  let qboCustomerId: string | undefined

  if (email) {
    const found = await ctx.callTool('find_quickbooks_customer', { email })
    if (found?.found && found.customer?.customerId) {
      qboCustomerId = String(found.customer.customerId)
    }
  }

  if (!qboCustomerId) {
    if (!displayName) {
      throw new Error(
        `Cannot create a QuickBooks customer for contact ${contactInstanceId} — it has no name ` +
          'or email.'
      )
    }
    const created = await ctx.callTool('create_quickbooks_customer', {
      displayName,
      ...(contactFields.firstName ? { givenName: contactFields.firstName } : {}),
      ...(contactFields.lastName ? { familyName: contactFields.lastName } : {}),
      ...(email ? { email } : {}),
    })
    qboCustomerId = String(created.customerId)
  }

  await writeQuickbooksIdField({
    organizationId,
    installationId: ctx.installationId,
    connectionId: ctx.connectionId,
    appFieldKey: QBO_CUSTOMER_ID_FIELD_KEY,
    entityType: 'contact',
    entityInstanceId: contactInstanceId,
    externalId: qboCustomerId,
    userId: ctx.userId,
  })

  return qboCustomerId
}
