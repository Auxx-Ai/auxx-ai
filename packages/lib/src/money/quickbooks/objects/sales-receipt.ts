// packages/lib/src/money/quickbooks/objects/sales-receipt.ts
// A fulfillment paid in full at shipment, sent as a QuickBooks SalesReceipt
// (plan 67 §1, §5.1). Dependencies resolved at send time: accounts, the
// generic item per revenue line, and the customer (or the channel
// placeholder for a `null` one).

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import {
  exportSalesReceiptSchema,
  SALES_RECEIPT_OBJECT_TYPE,
} from '../../../postings/export/payloads/sales-receipt'
import type {
  ProviderObjectContext,
  ReadObjectRef,
  ReadObjectResult,
  SendObjectInput,
  SendObjectResult,
  WithdrawObjectInput,
} from '../../../postings/provider'
import { listChartAccounts } from '../../../postings/role-map'
import { ProviderPostError, type WithdrawResult } from '../../../postings/types'
import type { QuickbooksToolContext } from '../invoke-quickbooks-tool'
import { resolveCustomer, resolvePlaceholderCustomer } from './customers'
import { resolveItemsForAccounts, toSalesToolLines } from './items'
import {
  type AdoptedObject,
  errorMessage,
  findByDocNumber,
  QUICKBOOKS_PROVIDER_ID,
  readNativeObject,
  recoverOrClassify,
  requireToolInputs,
  resolveMappedAccounts,
  withdrawNativeObject,
} from './shared'

const logger = createScopedLogger('quickbooks-objects-sales-receipt')

const TOOL_CREATE = 'create_quickbooks_sales_receipt'
const TOOL_FIND = 'find_quickbooks_sales_receipt'
const TOOL_GET = 'get_quickbooks_sales_receipt'
const TOOL_DELETE = 'delete_quickbooks_sales_receipt'
const FIND_LIST_FIELD = 'salesReceipts'
const ID_FIELD = 'salesReceiptId'

function configError(message: string): Result<SendObjectResult, Error> {
  return err(
    new ProviderPostError(message, {
      failureClass: 'configuration',
      providerId: QUICKBOOKS_PROVIDER_ID,
    })
  )
}

/** The layer-2/recovery lookup: adopt an existing sales receipt by `docNumber`. */
async function findAdopt(
  tool: QuickbooksToolContext,
  docNumber: string
): Promise<AdoptedObject | undefined> {
  if (requireToolInputs(tool, TOOL_FIND, ['docNumber'])) return undefined
  const found = await findByDocNumber(tool, TOOL_FIND, FIND_LIST_FIELD, ID_FIELD, docNumber)
  return found
    ? {
        externalId: found.externalId,
        remoteVersion: found.syncToken,
        ...(tool.realmId && { tenantId: tool.realmId }),
      }
    : undefined
}

export async function send(
  tool: QuickbooksToolContext,
  ctx: ProviderObjectContext,
  input: SendObjectInput
): Promise<Result<SendObjectResult, Error>> {
  const organizationId = ctx.organizationId
  let payload: ReturnType<typeof exportSalesReceiptSchema.parse>
  try {
    payload = exportSalesReceiptSchema.parse(input.payload)
  } catch (error) {
    return err(
      new ProviderPostError(
        `The frozen export payload is not a sales receipt: ${errorMessage(error)}`,
        { failureClass: 'data', providerId: QUICKBOOKS_PROVIDER_ID }
      )
    )
  }
  const docNumber = payload.docNumber

  try {
    const glAccountIds = [
      ...payload.lines.map((line) => line.glAccountId),
      payload.depositTo.glAccountId,
    ]
    const accounts = await resolveMappedAccounts(tool, glAccountIds)
    if (accounts.isErr()) return configError(accounts.error.message)

    const ourChart = await listChartAccounts(database, organizationId)
    if (ourChart.isErr()) return configError(ourChart.error.message)
    const ourChartById = new Map(ourChart.value.map((row) => [row.id, row]))

    let customerId: string
    let itemIdByAccount: Map<string, string>
    try {
      customerId = payload.customer
        ? await resolveCustomer(tool, payload.customer.id)
        : await resolvePlaceholderCustomer(tool, payload.storeId)
      itemIdByAccount = await resolveItemsForAccounts(
        tool,
        payload.lines.map((line) => line.glAccountId),
        ourChartById,
        accounts.value
      )
    } catch (error) {
      return configError(errorMessage(error))
    }

    const depositToAccountId = accounts.value.get(payload.depositTo.glAccountId)?.id
    if (!depositToAccountId) return configError(`${docNumber} names no resolvable deposit account.`)

    const notReadyToFind = requireToolInputs(tool, TOOL_FIND, ['docNumber'])
    if (notReadyToFind) return configError(notReadyToFind)
    const existing = await findByDocNumber(tool, TOOL_FIND, FIND_LIST_FIELD, ID_FIELD, docNumber)
    if (existing) {
      logger.warn('QuickBooks already holds this DocNumber - adopting, not re-posting', {
        organizationId,
        docNumber,
      })
      return ok({
        status: 'already_exists',
        externalId: existing.externalId,
        remoteVersion: existing.syncToken,
        providerId: QUICKBOOKS_PROVIDER_ID,
        ...(tool.realmId && { tenantId: tool.realmId }),
      })
    }

    const notReadyToCreate = requireToolInputs(tool, TOOL_CREATE, [
      'customerId',
      'lines',
      'depositToAccountId',
    ])
    if (notReadyToCreate) return configError(notReadyToCreate)

    const created = await tool.callTool(TOOL_CREATE, {
      customerId,
      lines: toSalesToolLines(payload.lines, itemIdByAccount),
      depositToAccountId,
      txnDate: payload.txnDate,
      docNumber,
      privateNote: payload.privateNote,
      currency: payload.currency,
      requestId: input.idempotencyKey,
    })
    const externalId = created?.salesReceiptId ? String(created.salesReceiptId) : undefined
    if (!externalId)
      return err(
        new ProviderPostError('QuickBooks returned no sales receipt id', {
          failureClass: 'data',
          providerId: QUICKBOOKS_PROVIDER_ID,
        })
      )

    return ok({
      status: 'sent',
      externalId,
      remoteVersion: typeof created.syncToken === 'string' ? created.syncToken : null,
      providerId: QUICKBOOKS_PROVIDER_ID,
      ...(tool.realmId && { tenantId: tool.realmId }),
    })
  } catch (error) {
    return recoverOrClassify(
      organizationId,
      QUICKBOOKS_PROVIDER_ID,
      error,
      () => findAdopt(tool, docNumber),
      { docNumber }
    )
  }
}

export async function read(
  tool: QuickbooksToolContext,
  ref: ReadObjectRef
): Promise<Result<ReadObjectResult, Error>> {
  return readNativeObject(tool, ref, {
    getTool: TOOL_GET,
    getIdField: ID_FIELD,
    findTool: TOOL_FIND,
    findListField: FIND_LIST_FIELD,
    idField: ID_FIELD,
  })
}

export async function withdraw(
  tool: QuickbooksToolContext,
  input: WithdrawObjectInput
): Promise<Result<WithdrawResult, Error>> {
  return withdrawNativeObject(tool, input, { deleteTool: TOOL_DELETE, idField: ID_FIELD })
}

export { SALES_RECEIPT_OBJECT_TYPE }
