// packages/lib/src/accounting/providers/quickbooks/objects/bill.ts
// A `vendor_bill` posting, sent as a QuickBooks Bill with
// account-based lines - no items, unlike the sales-side objects (plan 67 §1,
// §5.1).

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { BILL_OBJECT_TYPE, exportBillSchema } from '../../../export/payloads/bill'
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
import { resolveVendor } from './customers'
import {
  type AdoptedObject,
  echoOf,
  errorMessage,
  findByDocNumber,
  QUICKBOOKS_PROVIDER_ID,
  readNativeObject,
  recoverOrClassify,
  requireToolInputs,
  resolveMappedAccounts,
  withdrawNativeObject,
} from './shared'

const logger = createScopedLogger('quickbooks-objects-bill')

const TOOL_CREATE = 'create_quickbooks_bill'
const TOOL_FIND = 'find_quickbooks_bill'
const TOOL_GET = 'get_quickbooks_bill'
const TOOL_DELETE = 'delete_quickbooks_bill'
const FIND_LIST_FIELD = 'bills'
const ID_FIELD = 'billId'

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
  let payload: ReturnType<typeof exportBillSchema.parse>
  try {
    payload = exportBillSchema.parse(input.payload)
  } catch (error) {
    return err(
      new ProviderPostError(`The frozen export payload is not a bill: ${errorMessage(error)}`, {
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

    let vendorId: string
    try {
      vendorId = await resolveVendor(tool, payload.vendor.id)
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
        echo: existing.echo,
      })
    }

    const notReadyToCreate = requireToolInputs(tool, TOOL_CREATE, ['vendorId', 'lines'])
    if (notReadyToCreate) return configError(notReadyToCreate)

    const lines = payload.lines.map((line) => {
      const account = accounts.value.accounts.get(line.glAccountId)
      return {
        accountId: account?.id ?? '',
        amountMinor: line.amountMinor,
        ...(line.memo ? { description: line.memo } : {}),
      }
    })

    const created = await tool.callTool(TOOL_CREATE, {
      vendorId,
      lines,
      ...(payload.dueDate ? { dueDate: payload.dueDate } : {}),
      txnDate: payload.txnDate,
      docNumber,
      privateNote: payload.privateNote,
      currency: payload.currency,
      requestId: input.idempotencyKey,
    })
    const externalId = created?.billId ? String(created.billId) : undefined
    if (!externalId)
      return err(
        new ProviderPostError('QuickBooks returned no bill id', {
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
      echo: echoOf(created),
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

export { BILL_OBJECT_TYPE }
