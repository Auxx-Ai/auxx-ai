// packages/lib/src/payment-gateways/writes.ts

/**
 * The three writes the payment gateways settings page needs: adding a
 * gateway, editing one, and archiving one
 * (`plans/accounting/tasks/13-cash-accounts-and-the-qbo-seam.md` §5.3).
 *
 * Writes only; the reads live in `reads.ts`. No permission checks - the router
 * asserts `ledgerControl` (`docs/lib-module-guide.md` §6).
 *
 * No delete. A gateway can carry posting history the moment a fulfillment
 * batch routes a shipment to its clearing account, and the removal question
 * this brief answers is `status: 'closed'` (§5.1: a rail is not permanent, and
 * a closed one still winds down its balance) - the same shape `bank_account`
 * chose over a hard delete for exactly this reason.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { BadRequestError, ConflictError, NotFoundError } from '../errors'
import { loadChartAccountsById } from '../postings/chart-accounts'
import { UnifiedCrudHandler } from '../resources/crud'
import { toRecordId } from '../resources/resource-id'
import {
  normaliseGatewayHandle,
  PAYMENT_GATEWAY_SETTLEMENT_SOURCES,
  PAYMENT_GATEWAY_STATUSES,
  type PaymentGatewayRow,
  type PaymentGatewaySettlementSourceValue,
  type PaymentGatewayStatusValue,
} from './client'
import { guard } from './guard'
import { getPaymentGateway, listPaymentGateways, requirePaymentGatewayFieldContext } from './reads'

const logger = createScopedLogger('payment-gateways')

/** What `createPaymentGateway` accepts. */
export interface CreatePaymentGatewayInput {
  organizationId: string
  actorUserId: string
  name: string
  handles: string[]
  /** The `gl_account` id this gateway settles into. Must be an active asset account. */
  clearingAccountId: string
  /** The `gl_account` id the processor withholds its fee into, or null. */
  feeAccountId?: string | null
  settlementSource?: PaymentGatewaySettlementSourceValue
  status?: PaymentGatewayStatusValue
  lastSettlementAt?: string | null
}

/** What `updatePaymentGateway` accepts. Undefined means "leave it alone". */
export interface UpdatePaymentGatewayInput {
  organizationId: string
  actorUserId: string
  paymentGatewayId: string
  name?: string
  handles?: string[]
  clearingAccountId?: string
  feeAccountId?: string | null
  settlementSource?: PaymentGatewaySettlementSourceValue
  status?: PaymentGatewayStatusValue
  lastSettlementAt?: string | null
}

/** What `archivePaymentGateway` accepts. */
export interface ArchivePaymentGatewayInput {
  organizationId: string
  actorUserId: string
  paymentGatewayId: string
}

/**
 * Add a gateway by hand.
 *
 * 🛑 **What it must NOT do: mint an account per gateway.** `clearingAccountId`
 * names an EXISTING chart account (§5.3's explicit rule); this never creates
 * one. Two rails sharing a clearing account is ordinary - `1200` already is
 * that for every gateway `FULFILLMENT_GATEWAY_DEBIT` does not recognise.
 */
export async function createPaymentGateway(
  db: Database,
  input: CreatePaymentGatewayInput
): Promise<Result<PaymentGatewayRow, Error>> {
  const { organizationId, actorUserId } = input
  return guard(
    async () => {
      const ctx = await requirePaymentGatewayFieldContext(organizationId)

      const name = input.name?.trim()
      if (!name) {
        throw new BadRequestError('A payment gateway needs a name')
      }

      const handles = normaliseHandleList(input.handles)
      if (handles.length === 0) {
        throw new BadRequestError('A payment gateway needs at least one handle')
      }

      const settlementSource = input.settlementSource ?? 'manual'
      assertSettlementSource(settlementSource)
      const status = input.status ?? 'active'
      assertStatus(status)

      await assertHandlesAvailable(db, organizationId, name, handles)
      await assertClearingAccount(db, organizationId, input.clearingAccountId)
      if (input.feeAccountId) {
        await assertFeeAccount(db, organizationId, input.feeAccountId)
      }

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      const created = await crud.create(ctx.paymentGatewayDefId, {
        payment_gateway_name: name,
        payment_gateway_handles: handles,
        payment_gateway_clearing_account: input.clearingAccountId.trim(),
        payment_gateway_fee_account: input.feeAccountId?.trim() || undefined,
        payment_gateway_settlement_source: settlementSource,
        payment_gateway_status: status,
        payment_gateway_last_settlement_at: input.lastSettlementAt || undefined,
      })

      const row = await getPaymentGateway(db, organizationId, created.instance.id)
      if (row.isErr()) throw row.error
      if (!row.value) {
        throw new NotFoundError('The payment gateway could not be read back after writing')
      }

      logger.info('Created a payment gateway', {
        organizationId,
        paymentGatewayId: created.instance.id,
        handles,
      })
      return row.value
    },
    'Failed to create payment gateway',
    { organizationId }
  )
}

/**
 * Edit a gateway.
 *
 * ⚠️ `clearingAccountId` and `feeAccountId` are re-validated on every write,
 * not only at create time - a bookkeeper can archive a chart account after a
 * gateway was pointed at it, and an edit is the moment that surfaces rather
 * than a silent posting-time refusal months later.
 */
export async function updatePaymentGateway(
  db: Database,
  input: UpdatePaymentGatewayInput
): Promise<Result<PaymentGatewayRow, Error>> {
  const { organizationId, actorUserId, paymentGatewayId } = input
  return guard(
    async () => {
      const ctx = await requirePaymentGatewayFieldContext(organizationId)

      const existing = await getPaymentGateway(db, organizationId, paymentGatewayId)
      if (existing.isErr()) throw existing.error
      if (!existing.value) {
        throw new NotFoundError(`Payment gateway ${paymentGatewayId} was not found`)
      }

      const patch: Record<string, unknown> = {}

      if (input.name !== undefined) {
        const name = input.name.trim()
        if (!name) throw new BadRequestError('A payment gateway needs a name')
        patch.payment_gateway_name = name
      }

      let handles: string[] | undefined
      if (input.handles !== undefined) {
        handles = normaliseHandleList(input.handles)
        if (handles.length === 0) {
          throw new BadRequestError('A payment gateway needs at least one handle')
        }
        patch.payment_gateway_handles = handles
      }
      if (handles) {
        await assertHandlesAvailable(
          db,
          organizationId,
          input.name?.trim() || existing.value.name,
          handles,
          paymentGatewayId
        )
      }

      if (input.clearingAccountId !== undefined) {
        await assertClearingAccount(db, organizationId, input.clearingAccountId)
        patch.payment_gateway_clearing_account = input.clearingAccountId.trim()
      }
      if (input.feeAccountId !== undefined) {
        if (input.feeAccountId) {
          await assertFeeAccount(db, organizationId, input.feeAccountId)
        }
        patch.payment_gateway_fee_account = input.feeAccountId?.trim() || null
      }
      if (input.settlementSource !== undefined) {
        assertSettlementSource(input.settlementSource)
        patch.payment_gateway_settlement_source = input.settlementSource
      }
      if (input.status !== undefined) {
        assertStatus(input.status)
        patch.payment_gateway_status = input.status
      }
      if (input.lastSettlementAt !== undefined) {
        patch.payment_gateway_last_settlement_at = input.lastSettlementAt || null
      }

      if (Object.keys(patch).length > 0) {
        const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
        await crud.update(toRecordId(ctx.paymentGatewayDefId, paymentGatewayId), patch)
      }

      const row = await getPaymentGateway(db, organizationId, paymentGatewayId)
      if (row.isErr()) throw row.error
      if (!row.value) {
        throw new NotFoundError('The payment gateway could not be read back after writing')
      }

      logger.info('Updated a payment gateway', {
        organizationId,
        paymentGatewayId,
        fields: Object.keys(patch),
      })
      return row.value
    },
    'Failed to update payment gateway',
    { organizationId, paymentGatewayId }
  )
}

/**
 * Mark a gateway closed. Not a delete (see the file header) - a closed rail
 * still routes its own history (`toGatewayRoutes` in `client.ts` reads active
 * AND closed rows) and its clearing balance still has to wind down to zero.
 */
export async function archivePaymentGateway(
  db: Database,
  input: ArchivePaymentGatewayInput
): Promise<Result<PaymentGatewayRow, Error>> {
  const { organizationId, actorUserId, paymentGatewayId } = input
  return guard(
    async () => {
      const ctx = await requirePaymentGatewayFieldContext(organizationId)
      const existing = await getPaymentGateway(db, organizationId, paymentGatewayId)
      if (existing.isErr()) throw existing.error
      if (!existing.value) {
        throw new NotFoundError(`Payment gateway ${paymentGatewayId} was not found`)
      }
      if (existing.value.status === 'closed') {
        throw new ConflictError('That payment gateway is already closed.')
      }

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      await crud.update(toRecordId(ctx.paymentGatewayDefId, paymentGatewayId), {
        payment_gateway_status: 'closed',
      })

      const row = await getPaymentGateway(db, organizationId, paymentGatewayId)
      if (row.isErr()) throw row.error
      if (!row.value) {
        throw new NotFoundError('The payment gateway could not be read back after closing')
      }

      logger.info('Closed a payment gateway', { organizationId, paymentGatewayId })
      return row.value
    },
    'Failed to close payment gateway',
    { organizationId, paymentGatewayId }
  )
}

/** Trim every handle, drop blanks, and de-duplicate case-sensitively (the stored value keeps its casing). */
function normaliseHandleList(handles: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of handles) {
    const trimmed = raw?.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function assertSettlementSource(
  value: string
): asserts value is PaymentGatewaySettlementSourceValue {
  if (!PAYMENT_GATEWAY_SETTLEMENT_SOURCES.includes(value as PaymentGatewaySettlementSourceValue)) {
    throw new BadRequestError(
      `"${value}" is not a settlement source. Use ${PAYMENT_GATEWAY_SETTLEMENT_SOURCES.join(', ')}`
    )
  }
}

function assertStatus(value: string): asserts value is PaymentGatewayStatusValue {
  if (!PAYMENT_GATEWAY_STATUSES.includes(value as PaymentGatewayStatusValue)) {
    throw new BadRequestError(
      `"${value}" is not a status. Use ${PAYMENT_GATEWAY_STATUSES.join(' or ')}`
    )
  }
}

/**
 * Refuse two records sharing a normalised handle, naming both.
 *
 * §5.1's census is why this exists: `authorize_net`/`authorize.net` and
 * `Affirm`/`affirm` are each one rail under two spellings, and a
 * `payment_gateway` keyed on the handle needs both mapped to ONE row - so a
 * second record claiming a handle the first already holds is never a valid
 * state, whichever spelling it arrives under.
 */
async function assertHandlesAvailable(
  db: Database,
  organizationId: string,
  name: string,
  handles: readonly string[],
  excludeId?: string
): Promise<void> {
  const existing = await listPaymentGateways(db, organizationId)
  if (existing.isErr()) throw existing.error

  const wanted = new Set(handles.map(normaliseGatewayHandle))
  for (const gateway of existing.value) {
    if (gateway.id === excludeId) continue
    for (const handle of gateway.handles) {
      if (wanted.has(normaliseGatewayHandle(handle))) {
        throw new ConflictError(
          `"${handle}" is already a handle on ${gateway.name || 'another gateway'} - ` +
            `${name} and ${gateway.name || 'that gateway'} cannot share a handle.`
        )
      }
    }
  }
}

/** The clearing account must exist, be active, and be an asset account. */
async function assertClearingAccount(
  db: Database,
  organizationId: string,
  clearingAccountId: string
): Promise<void> {
  const id = clearingAccountId?.trim()
  if (!id) throw new BadRequestError('A payment gateway needs a clearing account')
  await assertAccount(db, organizationId, id, 'asset', 'clearing account')
}

/** The fee account, when given, must exist, be active, and be an expense account. */
async function assertFeeAccount(
  db: Database,
  organizationId: string,
  feeAccountId: string
): Promise<void> {
  const id = feeAccountId?.trim()
  if (!id) return
  await assertAccount(db, organizationId, id, 'expense', 'fee account')
}

async function assertAccount(
  db: Database,
  organizationId: string,
  accountId: string,
  wantType: 'asset' | 'expense',
  label: string
): Promise<void> {
  const { accounts, malformed } = await loadChartAccountsById(
    db,
    organizationId,
    [accountId],
    'Payment gateways cannot be mapped until the chart of accounts is provisioned'
  )
  const account = accounts.get(accountId)
  if (!account || malformed.includes(accountId)) {
    throw new BadRequestError(`The ${label} does not exist in your chart, or has been removed.`)
  }
  if (!account.isActive) {
    throw new BadRequestError(
      `"${account.name || account.code}" is inactive and cannot be a ${label}.`
    )
  }
  if (account.accountType !== wantType) {
    throw new BadRequestError(
      `"${account.name || account.code}" is a ${account.accountType} account. A ${label} must be ${wantType === 'asset' ? 'an asset' : 'an expense'} account.`
    )
  }
}
