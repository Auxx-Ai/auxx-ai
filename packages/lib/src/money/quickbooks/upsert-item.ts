// packages/lib/src/money/quickbooks/upsert-item.ts

import { toRecordId } from '@auxx/types/resource'
import type { UnifiedCrudHandler } from '../../resources/crud'
import { readQuickbooksIdField, writeQuickbooksIdField } from './identity-field'
import type { QuickbooksToolContext } from './invoke-quickbooks-tool'

const QBO_ITEM_ID_FIELD_KEY = 'qboItemId'

export interface UpsertQuickbooksItemInput {
  organizationId: string
  /** Line name used to create/match the QBO item — `line_item_name`, never the catalog default. */
  itemName: string
  /** Present when the line was picked from the catalog — enables the id-map fast path + write-back. */
  catalogItemInstanceId?: string
  /** `quickbooks.defaultIncomeAccountId` org setting — required only when a create is needed. */
  defaultIncomeAccountId?: string | null
  handler: UnifiedCrudHandler
}

/**
 * Find-or-create the QuickBooks `Item` mapped to an invoice line (money plan
 * 37e-quickbooks-invoice-sync.md §3 step 3, decision D5). Resolution order:
 *
 * 1. Stored `qboItemId` id-map field on the line's catalog item — only checked when the line
 *    has one (ad-hoc lines with no `line_item_catalog_item` always fall through).
 * 2. Case-insensitive name match against `list_quickbooks_items`.
 * 3. `create_quickbooks_item` against the org's default income account — throws a clear error
 *    (mapped to `status: 'error'` by the caller) when no default account is configured, since
 *    QBO requires one for every Service item.
 *
 * Only writes the id-map field back when `catalogItemInstanceId` is given — a one-off line
 * with no catalog item has nothing to remember the mapping on.
 */
export async function upsertQuickbooksItem(
  ctx: QuickbooksToolContext,
  input: UpsertQuickbooksItemInput
): Promise<string> {
  const { organizationId, itemName, catalogItemInstanceId, defaultIncomeAccountId, handler } = input

  if (catalogItemInstanceId) {
    const stored = await readQuickbooksIdField({
      organizationId,
      installationId: ctx.installationId,
      connectionId: ctx.connectionId,
      appFieldKey: QBO_ITEM_ID_FIELD_KEY,
      recordId: toRecordId('catalog_item', catalogItemInstanceId),
      handler,
    })
    if (stored) return stored
  }

  const { items } = await ctx.callTool('list_quickbooks_items', {})
  const nameMatch = (items ?? []).find(
    (item: { id: string; name: string }) => item.name?.toLowerCase() === itemName.toLowerCase()
  )

  let qboItemId: string
  if (nameMatch) {
    qboItemId = String(nameMatch.id)
  } else {
    if (!defaultIncomeAccountId) {
      throw new Error(
        `Cannot create a QuickBooks item for "${itemName}" — set a default income account under ` +
          'Settings → Money → Invoicing → QuickBooks first.'
      )
    }
    const created = await ctx.callTool('create_quickbooks_item', {
      name: itemName,
      incomeAccountId: defaultIncomeAccountId,
    })
    qboItemId = String(created.itemId)
  }

  if (catalogItemInstanceId) {
    await writeQuickbooksIdField({
      organizationId,
      installationId: ctx.installationId,
      connectionId: ctx.connectionId,
      appFieldKey: QBO_ITEM_ID_FIELD_KEY,
      entityType: 'catalog_item',
      entityInstanceId: catalogItemInstanceId,
      externalId: qboItemId,
      userId: ctx.userId,
    })
  }

  return qboItemId
}
