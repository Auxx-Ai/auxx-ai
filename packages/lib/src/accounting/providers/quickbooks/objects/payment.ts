// packages/lib/src/accounting/providers/quickbooks/objects/payment.ts
// A customer receipt against an invoice or a fulfillment sent as Invoice,
// sent as a QuickBooks Payment (plan 67 §1, §5.1, §5.2). Payment carries no
// `DocNumber` in QuickBooks, so - like Deposit - there is no doc-number heal
// and no `find` tool.

import { type Database, database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { exportObjectTypeLabel } from '../../../export/client'
import { exportPaymentSchema, PAYMENT_OBJECT_TYPE } from '../../../export/payloads/payment'
import { readLiveBatchMemberships } from '../../../export/queue-reads'
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
import {
  echoOf,
  errorMessage,
  QUICKBOOKS_PROVIDER_ID,
  readNativeObject,
  recoverOrClassify,
  requireToolInputs,
  resolveMappedAccounts,
  withdrawNativeObject,
} from './shared'

const TOOL_CREATE = 'create_quickbooks_payment'
const TOOL_GET = 'get_quickbooks_payment'
const TOOL_DELETE = 'delete_quickbooks_payment'
const ID_FIELD = 'paymentId'

function configError(message: string): Result<SendObjectResult, Error> {
  return err(
    new ProviderPostError(message, {
      failureClass: 'configuration',
      providerId: QUICKBOOKS_PROVIDER_ID,
    })
  )
}

interface AppliesToBatch {
  state: string
  objectType: string
  providerObjectId: string | null
  docNumber: string | null
}

/** `appliesTo.glPostingId` -> its live `ExportBatchPosting` -> that batch, or null when nothing has claimed it yet. */
async function resolveAppliesToBatch(
  db: Database,
  organizationId: string,
  glPostingId: string
): Promise<AppliesToBatch | null> {
  const [member] = await readLiveBatchMemberships(db, organizationId, {
    glPostingIds: [glPostingId],
  })
  if (!member) return null

  const [batch] = await db
    .select({
      state: schema.ExportBatch.state,
      objectType: schema.ExportBatch.objectType,
      providerObjectId: schema.ExportBatch.providerObjectId,
      payload: schema.ExportBatch.payload,
    })
    .from(schema.ExportBatch)
    .where(
      and(
        eq(schema.ExportBatch.organizationId, organizationId),
        eq(schema.ExportBatch.id, member.batchId)
      )
    )
    .limit(1)
  if (!batch) return null
  return {
    state: batch.state,
    objectType: batch.objectType,
    providerObjectId: batch.providerObjectId,
    docNumber: (batch.payload as { docNumber?: string } | null)?.docNumber ?? null,
  }
}

export async function send(
  tool: QuickbooksToolContext,
  ctx: ProviderObjectContext,
  input: SendObjectInput
): Promise<Result<SendObjectResult, Error>> {
  const organizationId = ctx.organizationId
  let payload: ReturnType<typeof exportPaymentSchema.parse>
  try {
    payload = exportPaymentSchema.parse(input.payload)
  } catch (error) {
    return err(
      new ProviderPostError(`The frozen export payload is not a payment: ${errorMessage(error)}`, {
        failureClass: 'data',
        providerId: QUICKBOOKS_PROVIDER_ID,
      })
    )
  }

  try {
    // §5.2's dependency: the invoice (or fulfillment sent as one) this
    // payment applies to must have SENT before this can. Checked first and
    // cheaply, before any resolution below spends a QuickBooks call.
    // `ProviderObjectContext` carries no handle, so the global is the db here.
    const appliesToBatch = await resolveAppliesToBatch(
      database,
      organizationId,
      payload.appliesTo.glPostingId
    )
    if (!appliesToBatch || appliesToBatch.state !== 'sent') {
      const label = appliesToBatch
        ? exportObjectTypeLabel(appliesToBatch.objectType).toLowerCase()
        : 'invoice'
      const docNumber = appliesToBatch?.docNumber ?? null
      return ok({
        status: 'waiting',
        externalId: '',
        remoteVersion: null,
        providerId: QUICKBOOKS_PROVIDER_ID,
        waitingReason: docNumber
          ? `Waiting for ${label} ${docNumber} to send`
          : `Waiting for the ${label} it applies to, to send`,
      })
    }
    const invoiceExternalId = appliesToBatch.providerObjectId
    if (!invoiceExternalId)
      return configError('The invoice this payment applies to has no recorded provider id.')

    const accounts = await resolveMappedAccounts(tool, [payload.depositTo.glAccountId])
    if (accounts.isErr()) return err(accounts.error)
    const depositToAccountId = accounts.value.accounts.get(payload.depositTo.glAccountId)?.id
    if (!depositToAccountId)
      return configError('This payment names no resolvable deposit-to account.')

    let customerId: string
    try {
      customerId = await resolveCustomer(tool, payload.customer.id)
    } catch (error) {
      return configError(errorMessage(error))
    }

    const notReadyToCreate = requireToolInputs(tool, TOOL_CREATE, [
      'customerId',
      'amountMinor',
      'depositToAccountId',
      'invoiceId',
    ])
    if (notReadyToCreate) return configError(notReadyToCreate)

    const created = await tool.callTool(TOOL_CREATE, {
      customerId,
      amountMinor: payload.amountMinor,
      depositToAccountId,
      invoiceId: invoiceExternalId,
      txnDate: payload.txnDate,
      paymentRefNum: payload.docNumber,
      privateNote: payload.privateNote,
      requestId: input.idempotencyKey,
    })
    const externalId = created?.paymentId ? String(created.paymentId) : undefined
    if (!externalId)
      return err(
        new ProviderPostError('QuickBooks returned no payment id', {
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
    // No doc-number net: Payment carries none in QuickBooks, so a create
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

export { PAYMENT_OBJECT_TYPE }
