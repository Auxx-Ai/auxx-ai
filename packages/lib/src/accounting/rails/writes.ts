// packages/lib/src/accounting/rails/writes.ts

/**
 * The three writes the payment gateways settings page needs: adding a
 * gateway, editing one, and archiving one
 * (`plans/accounting/tasks/done/13-cash-accounts-and-the-qbo-seam.md` §5.3).
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
import { BadRequestError, ConflictError, NotFoundError } from '../../errors'
import { UnifiedCrudHandler } from '../../resources/crud'
import { toRecordId } from '../../resources/resource-id'
import { ACCOUNT_ROLES } from '../ledger/builders/entry'
import { setRoleAssignment } from '../ledger/roles/role-map'
import { wakeReasonCode } from '../work-items/wake'
import {
  normaliseGatewayHandle,
  PAYMENT_GATEWAY_FEE_TREATMENTS,
  PAYMENT_GATEWAY_STATUSES,
  type PaymentGatewayFeeTreatmentValue,
  type PaymentGatewayRow,
  type PaymentGatewayStatusValue,
} from './client'
import { guard } from './guard'
import { getPaymentGateway, listPaymentGateways, requirePaymentGatewayDefId } from './reads'

const logger = createScopedLogger('payment-gateways')

/** What `createPaymentGateway` accepts. */
export interface CreatePaymentGatewayInput {
  organizationId: string
  actorUserId: string
  name: string
  handles: string[]
  /**
   * The `gl_account` id this rail's `clearing` role maps to (task 58 §3), written through
   * `setRoleAssignment` - an active asset account with subtype `clearing`.
   */
  clearingAccountId: string
  /** Like {@link clearingAccountId}, for the rail's `payment_processing_fees` role, or null. */
  feeAccountId?: string | null
  /**
   * Whether the processor withholds its cut from the deposit (`netted`) or
   * bills for it later (`billed`). Defaults to `netted`, which is what the
   * payout builder has always assumed.
   */
  feeTreatment?: PaymentGatewayFeeTreatmentValue
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
  /** Repoints the rail's `clearing` role. See {@link CreatePaymentGatewayInput.clearingAccountId}. */
  clearingAccountId?: string
  /** Repoints the rail's fee role; `null` clears the override back to the org default. */
  feeAccountId?: string | null
  feeTreatment?: PaymentGatewayFeeTreatmentValue
  status?: PaymentGatewayStatusValue
  lastSettlementAt?: string | null
}

/** What `archivePaymentGateway` accepts. */
export interface ArchivePaymentGatewayInput {
  organizationId: string
  actorUserId: string
  paymentGatewayId: string
}

/** What `stampPaymentGatewayLastSettlement` accepts. */
export interface StampPaymentGatewayLastSettlementInput {
  organizationId: string
  actorUserId: string
  paymentGatewayId: string
  /** `YYYY-MM-DD`: the paid-at date of the payout that just posted. */
  settledAt: string
}

/**
 * Add a gateway by hand.
 *
 * 🛑 **What it must NOT do: mint an account per gateway.** `clearingAccountId`
 * names an EXISTING chart account (§5.3's explicit rule); this never creates
 * one. Two rails sharing a clearing account is ordinary - `1200` already is
 * that for every gateway with no `payment_gateway` record of its own.
 *
 * The clearing/fee mapping is no longer a field on the record - it is two
 * `setRoleAssignment` writes scoped to the new record's id (task 58 §3), which
 * carry their own account-type/subtype validation. Not one transaction with the
 * entity create: `setRoleAssignment` opens its own, the same accepted gap
 * `setUpPaymentGateway` (`set-up.ts`) already documents for
 * `mintRailAccounts` plus this function.
 */
export async function createPaymentGateway(
  db: Database,
  input: CreatePaymentGatewayInput
): Promise<Result<PaymentGatewayRow, Error>> {
  const { organizationId, actorUserId } = input
  return guard(
    async () => {
      const defId = await requirePaymentGatewayDefId(organizationId)

      const name = input.name?.trim()
      if (!name) {
        throw new BadRequestError('A payment gateway needs a name')
      }

      const handles = normaliseHandleList(input.handles)
      if (handles.length === 0) {
        throw new BadRequestError('A payment gateway needs at least one handle')
      }

      // 🛑 Defaulted here AND stamped by migration 156 on every record that
      // predates the field, so the value is never absent and §4's default does
      // not end up living in three places.
      const feeTreatment = input.feeTreatment ?? 'netted'
      assertFeeTreatment(feeTreatment)
      const status = input.status ?? 'active'
      assertStatus(status)

      const clearingAccountId = input.clearingAccountId?.trim()
      if (!clearingAccountId) {
        throw new BadRequestError('A payment gateway needs a clearing account')
      }

      await assertHandlesAvailable(db, organizationId, name, handles)

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      const created = await crud.create(defId, {
        payment_gateway_name: name,
        payment_gateway_handles: handles,
        payment_gateway_fee_treatment: feeTreatment,
        payment_gateway_status: status,
        payment_gateway_last_settlement_at: input.lastSettlementAt || undefined,
      })
      const paymentGatewayId = created.instance.id

      const clearing = await setRoleAssignment(db, {
        organizationId,
        role: ACCOUNT_ROLES.CLEARING,
        paymentGatewayId,
        glAccountId: clearingAccountId,
        actorUserId,
      })
      if (clearing.isErr()) throw clearing.error

      const feeAccountId = input.feeAccountId?.trim()
      if (feeAccountId) {
        const fee = await setRoleAssignment(db, {
          organizationId,
          role: ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES,
          paymentGatewayId,
          glAccountId: feeAccountId,
          actorUserId,
        })
        if (fee.isErr()) throw fee.error
      }

      const row = await getPaymentGateway(db, organizationId, paymentGatewayId)
      if (row.isErr()) throw row.error
      if (!row.value) {
        throw new NotFoundError('The payment gateway could not be read back after writing')
      }

      await wakeReasonCode(db, organizationId, 'GATEWAY_UNMAPPED')
      logger.info('Created a payment gateway', {
        organizationId,
        paymentGatewayId,
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
      const defId = await requirePaymentGatewayDefId(organizationId)

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
        const clearingAccountId = input.clearingAccountId.trim()
        if (!clearingAccountId) {
          throw new BadRequestError('A payment gateway needs a clearing account')
        }
        const clearing = await setRoleAssignment(db, {
          organizationId,
          role: ACCOUNT_ROLES.CLEARING,
          paymentGatewayId,
          glAccountId: clearingAccountId,
          actorUserId,
        })
        if (clearing.isErr()) throw clearing.error
      }
      if (input.feeAccountId !== undefined) {
        const feeAccountId = input.feeAccountId?.trim()
        const fee = feeAccountId
          ? await setRoleAssignment(db, {
              organizationId,
              role: ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES,
              paymentGatewayId,
              glAccountId: feeAccountId,
              actorUserId,
            })
          : await setRoleAssignment(db, {
              organizationId,
              role: ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES,
              paymentGatewayId,
              useDefault: true,
              actorUserId,
            })
        if (fee.isErr()) throw fee.error
      }
      if (input.feeTreatment !== undefined) {
        assertFeeTreatment(input.feeTreatment)
        patch.payment_gateway_fee_treatment = input.feeTreatment
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
        await crud.update(toRecordId(defId, paymentGatewayId), patch)
      }

      const row = await getPaymentGateway(db, organizationId, paymentGatewayId)
      if (row.isErr()) throw row.error
      if (!row.value) {
        throw new NotFoundError('The payment gateway could not be read back after writing')
      }

      if (handles) await wakeReasonCode(db, organizationId, 'GATEWAY_UNMAPPED')
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
 * carries its own history - movements already stamped with it still post to its
 * clearing account - and that clearing balance still has to wind down to zero.
 */
export async function archivePaymentGateway(
  db: Database,
  input: ArchivePaymentGatewayInput
): Promise<Result<PaymentGatewayRow, Error>> {
  const { organizationId, actorUserId, paymentGatewayId } = input
  return guard(
    async () => {
      const defId = await requirePaymentGatewayDefId(organizationId)
      const existing = await getPaymentGateway(db, organizationId, paymentGatewayId)
      if (existing.isErr()) throw existing.error
      if (!existing.value) {
        throw new NotFoundError(`Payment gateway ${paymentGatewayId} was not found`)
      }
      if (existing.value.status === 'closed') {
        throw new ConflictError('That payment gateway is already closed.')
      }

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      await crud.update(toRecordId(defId, paymentGatewayId), {
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

/**
 * Advance a rail's `lastSettlementAt` watermark to `settledAt`, when that is
 * later than what the record holds
 * (`plans/accounting/tasks/27-a-settlement-from-anywhere.md` §6.5).
 *
 * The payout source calls this after each entry it posts, which is the "real
 * write moment" brief 26 §6 owed for this field - until now it was hand-entered
 * and nothing derived it. Monotonic: a re-run over an older payout, or a source
 * that lists oldest-first and is interrupted, can never move the watermark
 * BACK, so `advanced: false` is an ordinary answer and not a fault.
 *
 * A `YYYY-MM-DD` string compares as a date, which is why no `Date` is parsed
 * here; anything else is refused rather than coerced.
 */
export async function stampPaymentGatewayLastSettlement(
  db: Database,
  input: StampPaymentGatewayLastSettlementInput
): Promise<Result<{ advanced: boolean }, Error>> {
  const { organizationId, actorUserId, paymentGatewayId, settledAt } = input
  return guard(
    async () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(settledAt)) {
        throw new BadRequestError(`"${settledAt}" is not a YYYY-MM-DD date`)
      }

      const defId = await requirePaymentGatewayDefId(organizationId)
      // A closed rail still settles its last payouts, so archived rows are read too.
      const existing = await getPaymentGateway(db, organizationId, paymentGatewayId, {
        includeArchived: true,
      })
      if (existing.isErr()) throw existing.error
      if (!existing.value) {
        throw new NotFoundError(`Payment gateway ${paymentGatewayId} was not found`)
      }

      const held = existing.value.lastSettlementAt
      if (held && held >= settledAt) return { advanced: false }

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      await crud.update(toRecordId(defId, paymentGatewayId), {
        payment_gateway_last_settlement_at: settledAt,
      })
      return { advanced: true }
    },
    'Failed to stamp payment gateway last settlement',
    { organizationId, paymentGatewayId, settledAt }
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

/**
 * 🛑 A refusal, never a coercion to `netted`. `resolvePaymentGatewayFeeTreatment`
 * coerces on the READ side because an unmigrated record legitimately has no
 * value; a write path that coerced a typo would silently put a billed rail back
 * on the netted path and re-introduce a fee leg its deposits never carried.
 */
function assertFeeTreatment(value: string): asserts value is PaymentGatewayFeeTreatmentValue {
  if (!PAYMENT_GATEWAY_FEE_TREATMENTS.includes(value as PaymentGatewayFeeTreatmentValue)) {
    throw new BadRequestError(
      `"${value}" is not a fee treatment. Use ${PAYMENT_GATEWAY_FEE_TREATMENTS.join(' or ')}`
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
