// packages/lib/src/accounting/providers/quickbooks/objects/customers.ts
// Resolve one native payload's counterparty to a QuickBooks Customer or
// Vendor (plan 67 §5.2): a named customer through `upsert-customer.ts`, a
// `null` customer through the channel placeholder on
// `FinancialSourceAccount.providerCustomerRef`, a vendor through the same
// (refuse-if-unsynced) resolution the journal path already used.

import { type Database, schema } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { UnprocessableEntityError } from '../../../../errors'
import { UnifiedCrudHandler } from '../../../../resources/crud'
import { readSourceAccounts } from '../../../money/customer-money/source-reads'
import { readQuickbooksIdField } from '../identity-field'
import type { QuickbooksToolContext } from '../invoke-quickbooks-tool'
import { readQuickbooksCustomerFields, upsertQuickbooksCustomer } from '../upsert-customer'
import { memoised } from './shared'

const QBO_CUSTOMER_ID_FIELD_KEY = 'qboCustomerId'
/** Not provisioned by the app yet (brief 13 DECIDED, unit 1) - a vendor line always refuses below. */
const QBO_VENDOR_ID_FIELD_KEY = 'qboVendorId'

/**
 * A payload's `customer: { type: 'customer', id }` -> QuickBooks Customer id,
 * creating one on a miss exactly as the journal's counterparty resolution
 * does for a receivable line.
 */
export function resolveCustomer(
  tool: QuickbooksToolContext,
  contactInstanceId: string
): Promise<string> {
  return memoised(tool, `customer:${contactInstanceId}`, () =>
    resolveCustomerOnce(tool, contactInstanceId)
  )
}

async function resolveCustomerOnce(
  tool: QuickbooksToolContext,
  contactInstanceId: string
): Promise<string> {
  const handler = new UnifiedCrudHandler(tool.organizationId, tool.userId)
  const stored = await readQuickbooksIdField({
    organizationId: tool.organizationId,
    installationId: tool.installationId,
    connectionId: tool.connectionId,
    appFieldKey: QBO_CUSTOMER_ID_FIELD_KEY,
    recordId: toRecordId('contact', contactInstanceId),
    handler,
  })
  if (stored) return stored

  const contactFields = await readQuickbooksCustomerFields(tool.organizationId, contactInstanceId)
  return upsertQuickbooksCustomer(tool, {
    organizationId: tool.organizationId,
    contactInstanceId,
    contactFields,
    handler,
  })
}

/**
 * A payload's `vendor: { type: 'vendor', id }` -> QuickBooks Vendor id.
 *
 * 🛑 No create path, on purpose: `qboVendorId` is not a field the app
 * provisions yet, so this refuses exactly as the journal path's payable line
 * does. Mirror the customer ladder once a vendor bill actually posts.
 */
export function resolveVendor(
  tool: QuickbooksToolContext,
  companyInstanceId: string
): Promise<string> {
  return memoised(tool, `vendor:${companyInstanceId}`, () =>
    resolveVendorOnce(tool, companyInstanceId)
  )
}

async function resolveVendorOnce(
  tool: QuickbooksToolContext,
  companyInstanceId: string
): Promise<string> {
  const handler = new UnifiedCrudHandler(tool.organizationId, tool.userId)
  const stored = await readQuickbooksIdField({
    organizationId: tool.organizationId,
    installationId: tool.installationId,
    connectionId: tool.connectionId,
    appFieldKey: QBO_VENDOR_ID_FIELD_KEY,
    recordId: toRecordId('company', companyInstanceId),
    handler,
  })
  if (stored) return stored
  throw new UnprocessableEntityError(
    `This bill's vendor has no QuickBooks vendor synced yet, and auxx cannot create one for it.`,
    { organizationId: tool.organizationId, companyInstanceId }
  )
}

/**
 * The channel placeholder customer for a `null` counterparty (T14): read from
 * `FinancialSourceAccount.providerCustomerRef.quickbooks`, created on first
 * use as `auxx:<store name or storeId>` and written back to the column.
 *
 * 🛑 Requires a store. A `null` counterparty with no store has nothing to
 * create or persist a placeholder against, so this refuses rather than
 * minting an unaddressable customer nobody can find again.
 */
export function resolvePlaceholderCustomer(
  db: Database,
  tool: QuickbooksToolContext,
  storeId: string | null
): Promise<string> {
  return memoised(tool, `placeholder:${storeId ?? ''}`, () =>
    resolvePlaceholderCustomerOnce(db, tool, storeId)
  )
}

async function resolvePlaceholderCustomerOnce(
  db: Database,
  tool: QuickbooksToolContext,
  storeId: string | null
): Promise<string> {
  if (!storeId) {
    throw new UnprocessableEntityError(
      'This document names no customer and no store to resolve a channel placeholder customer against.',
      { organizationId: tool.organizationId }
    )
  }

  const store = (await readSourceAccounts(db, tool.organizationId, [storeId])).get(storeId)
  if (!store) {
    throw new UnprocessableEntityError(
      `No financial source account '${storeId}' exists to resolve a channel placeholder customer against.`,
      { organizationId: tool.organizationId, storeId }
    )
  }

  const existing = store.providerCustomerRef?.quickbooks?.customerId
  if (existing) return existing

  const displayName = `auxx:${store.name ?? storeId}`
  const found = await tool.callTool('find_quickbooks_customer', { displayName })
  const customerId =
    found?.found && found.customer?.customerId
      ? String(found.customer.customerId)
      : String(
          (
            await tool.callTool('create_quickbooks_customer', {
              displayName,
              notes: `auxx:channel:${storeId}`,
            })
          ).customerId
        )

  await db
    .update(schema.FinancialSourceAccount)
    .set({
      providerCustomerRef: { ...(store.providerCustomerRef ?? {}), quickbooks: { customerId } },
    })
    .where(
      and(
        eq(schema.FinancialSourceAccount.organizationId, tool.organizationId),
        eq(schema.FinancialSourceAccount.id, storeId)
      )
    )

  return customerId
}
