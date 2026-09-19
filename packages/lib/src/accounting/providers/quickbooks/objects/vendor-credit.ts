// packages/lib/src/accounting/providers/quickbooks/objects/vendor-credit.ts
// A `vendor_credit` posting, sent as a QuickBooks Vendor Credit with
// account-based lines - `bill.ts` with the sides flipped (TARGET §5).

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import {
  exportVendorCreditSchema,
  VENDOR_CREDIT_OBJECT_TYPE,
} from '../../../export/payloads/vendor-credit'
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
  errorMessage,
  findByDocNumber,
  QUICKBOOKS_PROVIDER_ID,
  readNativeObject,
  recoverOrClassify,
  requireToolInputs,
  resolveMappedAccounts,
  withdrawNativeObject,
} from './shared'

const logger = createScopedLogger('quickbooks-objects-vendor-credit')

const TOOL_CREATE = 'create_quickbooks_vendor_credit'
const TOOL_FIND = 'find_quickbooks_vendor_credit'
const TOOL_GET = 'get_quickbooks_vendor_credit'
const TOOL_DELETE = 'delete_quickbooks_vendor_credit'
const FIND_LIST_FIELD = 'vendorCredits'
const ID_FIELD = 'vendorCreditId'

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
  let payload: ReturnType<typeof exportVendorCreditSchema.parse>
  try {
    payload = exportVendorCreditSchema.parse(input.payload)
  } catch (error) {
    return err(
      new ProviderPostError(
        `The frozen export payload is not a vendor credit: ${errorMessage(error)}`,
        { failureClass: 'data', providerId: QUICKBOOKS_PROVIDER_ID }
      )
    )
  }
  const docNumber = payload.docNumber

  try {
    const accounts = await resolveMappedAccounts(
      tool,
      payload.lines.map((line) => line.glAccountId)
    )
    if (accounts.isErr()) return configError(accounts.error.message)

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
      })
    }

    const notReadyToCreate = requireToolInputs(tool, TOOL_CREATE, ['vendorId', 'lines'])
    if (notReadyToCreate) return configError(notReadyToCreate)

    const lines = payload.lines.map((line) => {
      const account = accounts.value.get(line.glAccountId)
      return {
        accountId: account?.id ?? '',
        amountMinor: line.amountMinor,
        ...(line.memo ? { description: line.memo } : {}),
      }
    })

    const created = await tool.callTool(TOOL_CREATE, {
      vendorId,
      lines,
      txnDate: payload.txnDate,
      docNumber,
      privateNote: payload.privateNote,
      currency: payload.currency,
      requestId: input.idempotencyKey,
    })
    const externalId = created?.vendorCreditId ? String(created.vendorCreditId) : undefined
    if (!externalId)
      return err(
        new ProviderPostError('QuickBooks returned no vendor credit id', {
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

export { VENDOR_CREDIT_OBJECT_TYPE }
