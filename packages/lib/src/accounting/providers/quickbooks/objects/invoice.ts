// packages/lib/src/accounting/providers/quickbooks/objects/invoice.ts
// A fulfillment invoiced (not fully paid at shipment, or `exportShape:
// 'invoice'`) or a standalone `invoice_issued` posting, sent as a QuickBooks
// Invoice (plan 67 §1, §5.1).

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { exportInvoiceSchema, INVOICE_OBJECT_TYPE } from '../../../export/payloads/invoice'
import { listChartAccounts } from '../../../ledger/roles/role-map'
import { ProviderPostError, type WithdrawResult } from '../../../ledger/types'
import type {
  ProviderObjectContext,
  ReadObjectRef,
  ReadObjectResult,
  SendObjectInput,
  SendObjectResult,
  WithdrawObjectInput,
} from '../../provider'
import type { QuickbooksToolContext } from '../invoke-quickbooks-tool'
import { resolveCustomer } from './customers'
import { resolveItemsForAccounts } from './items'
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

const logger = createScopedLogger('quickbooks-objects-invoice')

const TOOL_CREATE = 'create_quickbooks_invoice'
const TOOL_FIND = 'find_quickbooks_invoice'
const TOOL_GET = 'get_quickbooks_invoice'
const TOOL_DELETE = 'delete_quickbooks_invoice'
const FIND_LIST_FIELD = 'invoices'
const ID_FIELD = 'invoiceId'

function configError(message: string): Result<SendObjectResult, Error> {
  return err(
    new ProviderPostError(message, {
      failureClass: 'configuration',
      providerId: QUICKBOOKS_PROVIDER_ID,
    })
  )
}

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
  let payload: ReturnType<typeof exportInvoiceSchema.parse>
  try {
    payload = exportInvoiceSchema.parse(input.payload)
  } catch (error) {
    return err(
      new ProviderPostError(`The frozen export payload is not an invoice: ${errorMessage(error)}`, {
        failureClass: 'data',
        providerId: QUICKBOOKS_PROVIDER_ID,
      })
    )
  }
  const docNumber = payload.docNumber

  try {
    const glAccountIds = payload.lines.map((line) => line.glAccountId)
    const accounts = await resolveMappedAccounts(tool, glAccountIds)
    if (accounts.isErr()) return err(accounts.error)

    const ourChart = await listChartAccounts(database, organizationId)
    if (ourChart.isErr()) return configError(ourChart.error.message)
    const ourChartById = new Map(ourChart.value.map((row) => [row.id, row]))

    let customerId: string
    let itemIdByAccount: Map<string, string>
    try {
      customerId = await resolveCustomer(tool, payload.customer.id)
      itemIdByAccount = await resolveItemsForAccounts(
        tool,
        glAccountIds,
        ourChartById,
        accounts.value
      )
    } catch (error) {
      return configError(errorMessage(error))
    }

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

    const notReadyToCreate = requireToolInputs(tool, TOOL_CREATE, ['customerId', 'lines'])
    if (notReadyToCreate) return configError(notReadyToCreate)

    const created = await tool.callTool(TOOL_CREATE, {
      customerId,
      lines: payload.lines.map((line) => ({
        itemId: itemIdByAccount.get(line.glAccountId) ?? '',
        amountMinor: line.amountMinor,
        quantity: 1,
        ...(line.memo ? { description: line.memo } : {}),
      })),
      docNumber,
      ...(payload.dueDate ? { dueDate: payload.dueDate } : {}),
      txnDate: payload.txnDate,
      privateNote: payload.privateNote,
      currency: payload.currency,
      requestId: input.idempotencyKey,
    })
    const externalId = created?.invoiceId ? String(created.invoiceId) : undefined
    if (!externalId)
      return err(
        new ProviderPostError('QuickBooks returned no invoice id', {
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

export { INVOICE_OBJECT_TYPE }
