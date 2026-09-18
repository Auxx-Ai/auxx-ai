// packages/lib/src/money/quickbooks/objects/items.ts
// One generic Service item per income `gl_account` (T13, plan 67 §5.2):
// `qboItemId` on the account, `find_quickbooks_item` by name before
// `create_quickbooks_item`, named `auxx:<accountCode|glAccountId>`.

import { toRecordId } from '@auxx/types/resource'
import { UnprocessableEntityError } from '../../../errors'
import type { ChartAccountRow, ProviderAccount } from '../../../postings/types'
import { UnifiedCrudHandler } from '../../../resources/crud'
import { readQuickbooksIdField, writeQuickbooksIdField } from '../identity-field'
import type { QuickbooksToolContext } from '../invoke-quickbooks-tool'
import { errorMessage, requireToolInputs } from './shared'

const QBO_ITEM_ID_FIELD_KEY = 'qboItemId'
const GL_ACCOUNT_ENTITY_TYPE = 'gl_account'
const TOOL_FIND_ITEM = 'find_quickbooks_item'
const TOOL_CREATE_ITEM = 'create_quickbooks_item'

/** `auxx:<accountCode|glAccountId>` - the generic item's name (T13). */
export function itemName(account: { code: string | null; id: string }): string {
  return `auxx:${account.code ?? account.id}`
}

/**
 * Resolve the generic Service item for one income `gl_account`, creating it
 * on a miss. `incomeAccountProviderId` is the account's ALREADY-RESOLVED
 * QuickBooks id (`resolveMappedAccounts`), never re-resolved here.
 */
export async function resolveOrCreateItem(
  tool: QuickbooksToolContext,
  account: { id: string; code: string | null },
  incomeAccountProviderId: string
): Promise<string> {
  const handler = new UnifiedCrudHandler(tool.organizationId, tool.userId)
  const recordId = toRecordId(GL_ACCOUNT_ENTITY_TYPE, account.id)
  const stored = await readQuickbooksIdField({
    organizationId: tool.organizationId,
    installationId: tool.installationId,
    connectionId: tool.connectionId,
    appFieldKey: QBO_ITEM_ID_FIELD_KEY,
    recordId,
    handler,
  })
  if (stored) return stored

  const name = itemName(account)

  const notReadyToFind = requireToolInputs(tool, TOOL_FIND_ITEM, ['name'])
  if (notReadyToFind)
    throw new UnprocessableEntityError(notReadyToFind, { glAccountId: account.id })

  const found = await tool.callTool(TOOL_FIND_ITEM, { name })
  if (found?.status === 'Found' && found.itemId) {
    const itemId = String(found.itemId)
    await writeItemId(tool, account.id, itemId)
    return itemId
  }

  const notReadyToCreate = requireToolInputs(tool, TOOL_CREATE_ITEM, ['name', 'incomeAccountId'])
  if (notReadyToCreate)
    throw new UnprocessableEntityError(notReadyToCreate, { glAccountId: account.id })

  try {
    const created = await tool.callTool(TOOL_CREATE_ITEM, {
      name,
      incomeAccountId: incomeAccountProviderId,
    })
    const itemId = created?.itemId ? String(created.itemId) : undefined
    if (!itemId) {
      throw new UnprocessableEntityError(`QuickBooks returned no item id for '${name}'.`, {
        organizationId: tool.organizationId,
        glAccountId: account.id,
      })
    }
    await writeItemId(tool, account.id, itemId)
    return itemId
  } catch (error) {
    throw new UnprocessableEntityError(
      `Could not resolve or create the QuickBooks item '${name}': ${errorMessage(error)}`,
      { organizationId: tool.organizationId, glAccountId: account.id }
    )
  }
}

/**
 * Resolve every distinct `glAccountId` an item-line payload names to its
 * generic Service item, once each. `resolvedAccounts` is the SAME map
 * `resolveMappedAccounts` already produced for this send - a miss there is
 * unreachable, since the caller resolves accounts before items.
 */
export async function resolveItemsForAccounts(
  tool: QuickbooksToolContext,
  glAccountIds: readonly string[],
  ourChart: ReadonlyMap<string, ChartAccountRow>,
  resolvedAccounts: ReadonlyMap<string, ProviderAccount>
): Promise<Map<string, string>> {
  const itemIdByAccount = new Map<string, string>()
  for (const glAccountId of new Set(glAccountIds)) {
    const account = ourChart.get(glAccountId)
    const providerAccount = resolvedAccounts.get(glAccountId)
    if (!account || !providerAccount) continue
    const itemId = await resolveOrCreateItem(
      tool,
      { id: account.id, code: account.code },
      providerAccount.id
    )
    itemIdByAccount.set(glAccountId, itemId)
  }
  return itemIdByAccount
}

/** One item-line payload turned into `create_quickbooks_<object>`'s line shape. */
export function toSalesToolLines(
  lines: ReadonlyArray<{
    glAccountId: string
    amountMinor: number
    memo?: string
    taxCode?: 'NON'
  }>,
  itemIdByAccount: ReadonlyMap<string, string>
): Array<{ itemId: string; amountMinor: number; description?: string; taxCode?: 'NON' }> {
  return lines.map((line) => ({
    itemId: itemIdByAccount.get(line.glAccountId) ?? '',
    amountMinor: line.amountMinor,
    ...(line.memo ? { description: line.memo } : {}),
    ...(line.taxCode ? { taxCode: line.taxCode } : {}),
  }))
}

async function writeItemId(
  tool: QuickbooksToolContext,
  glAccountId: string,
  itemId: string
): Promise<void> {
  await writeQuickbooksIdField({
    organizationId: tool.organizationId,
    installationId: tool.installationId,
    connectionId: tool.connectionId,
    appFieldKey: QBO_ITEM_ID_FIELD_KEY,
    entityType: GL_ACCOUNT_ENTITY_TYPE,
    entityInstanceId: glAccountId,
    externalId: itemId,
    userId: tool.userId,
  })
}
