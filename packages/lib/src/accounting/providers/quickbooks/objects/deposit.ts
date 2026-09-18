// packages/lib/src/accounting/providers/quickbooks/objects/deposit.ts
// A `payout` or `bank_deposit` posting, sent as a QuickBooks Deposit, the fee
// as a negative line (plan 67 §1, §5.1, §7 D4). Deposit carries no
// `DocNumber` in QuickBooks, so there is no layer-2 doc-number heal and no
// `find` tool - `requestId` (layer 3) is the only idempotency net.

import { err, ok, type Result } from 'neverthrow'
import { ProviderPostError, type WithdrawResult } from '../../../../postings/types'
import { DEPOSIT_OBJECT_TYPE, exportDepositSchema } from '../../../export/payloads/deposit'
import type {
  ProviderObjectContext,
  ReadObjectRef,
  ReadObjectResult,
  SendObjectInput,
  SendObjectResult,
  WithdrawObjectInput,
} from '../../provider'
import type { QuickbooksToolContext } from '../invoke-quickbooks-tool'
import {
  errorMessage,
  QUICKBOOKS_PROVIDER_ID,
  readNativeObject,
  recoverOrClassify,
  requireToolInputs,
  resolveMappedAccounts,
  withdrawNativeObject,
} from './shared'

const TOOL_CREATE = 'create_quickbooks_deposit'
const TOOL_GET = 'get_quickbooks_deposit'
const TOOL_DELETE = 'delete_quickbooks_deposit'
const ID_FIELD = 'depositId'

function configError(message: string): Result<SendObjectResult, Error> {
  return err(
    new ProviderPostError(message, {
      failureClass: 'configuration',
      providerId: QUICKBOOKS_PROVIDER_ID,
    })
  )
}

export async function send(
  tool: QuickbooksToolContext,
  ctx: ProviderObjectContext,
  input: SendObjectInput
): Promise<Result<SendObjectResult, Error>> {
  const organizationId = ctx.organizationId
  let payload: ReturnType<typeof exportDepositSchema.parse>
  try {
    payload = exportDepositSchema.parse(input.payload)
  } catch (error) {
    return err(
      new ProviderPostError(`The frozen export payload is not a deposit: ${errorMessage(error)}`, {
        failureClass: 'data',
        providerId: QUICKBOOKS_PROVIDER_ID,
      })
    )
  }

  try {
    const glAccountIds = [
      payload.depositTo.glAccountId,
      ...payload.lines.map((line) => line.fromAccount.glAccountId),
    ]
    const accounts = await resolveMappedAccounts(tool, glAccountIds)
    if (accounts.isErr()) return configError(accounts.error.message)

    const depositToAccountId = accounts.value.get(payload.depositTo.glAccountId)?.id
    if (!depositToAccountId)
      return configError('This deposit names no resolvable deposit-to account.')

    const notReadyToCreate = requireToolInputs(tool, TOOL_CREATE, ['depositToAccountId', 'lines'])
    if (notReadyToCreate) return configError(notReadyToCreate)

    const created = await tool.callTool(TOOL_CREATE, {
      depositToAccountId,
      lines: payload.lines.map((line) => ({
        accountId: accounts.value.get(line.fromAccount.glAccountId)?.id ?? '',
        amountMinor: line.amountMinor,
        ...(line.memo ? { memo: line.memo } : {}),
      })),
      txnDate: payload.txnDate,
      privateNote: payload.privateNote,
      currency: payload.currency,
      requestId: input.idempotencyKey,
    })
    const externalId = created?.depositId ? String(created.depositId) : undefined
    if (!externalId)
      return err(
        new ProviderPostError('QuickBooks returned no deposit id', {
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
    // No doc-number net: Deposit carries none in QuickBooks, so a create
    // failure of unknown outcome cannot be resolved by re-querying one.
    return recoverOrClassify(organizationId, QUICKBOOKS_PROVIDER_ID, error, null)
  }
}

export async function read(
  tool: QuickbooksToolContext,
  ref: ReadObjectRef
): Promise<Result<ReadObjectResult, Error>> {
  return readNativeObject(tool, ref, {
    getTool: TOOL_GET,
    getIdField: ID_FIELD,
    findTool: null,
    findListField: null,
    idField: ID_FIELD,
  })
}

export async function withdraw(
  tool: QuickbooksToolContext,
  input: WithdrawObjectInput
): Promise<Result<WithdrawResult, Error>> {
  return withdrawNativeObject(tool, input, { deleteTool: TOOL_DELETE, idField: ID_FIELD })
}

export { DEPOSIT_OBJECT_TYPE }
