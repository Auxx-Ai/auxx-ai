// packages/lib/src/money/payouts/routing.ts

/**
 * Which `payment_gateway` record a payout credits, from the source context
 * that read it. Pure: no database, no provider. The Stripe-specific wrapper
 * that used to be this whole file (`resolvePayoutGateway`) now lives with the
 * Stripe source (`sources/stripe-connect.ts`), because "which record is the
 * Connect rail" is the one question only that source can answer (27 §6.2).
 */

import {
  PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS,
  type PaymentGatewayFeeTreatmentValue,
} from '../../payment-gateways/client'
import type { PayoutSourceCtx } from './source'

/**
 * What a payout's own `payment_gateway` record contributes, or the sentence a
 * blocked payout carries. Never both.
 *
 * ⚠️ `clearingGlAccountId` and `feeGlAccountId` are OPTIONAL on the unblocked
 * branch on purpose: "no record claims this rail" is an ordinary, supported
 * answer, and it means the builder falls back to the roles exactly as it always
 * has. Only an AMBIGUOUS answer blocks.
 *
 * `reason` (brief 28 §5) is the unblocked arm's counterpart to `blockedReason`:
 * a refusal always said WHY, and an answer used to say nothing, so the reason an
 * entry hit the account it hit existed for one stack frame and was gone before
 * the row was written. It rides through `postPayoutEntry` onto the clearing line.
 */
export type ResolvedPayoutGateway =
  | {
      blockedReason: null
      /** The rail's own id, when exactly one record claims the stream. Absent on the role fallback. */
      paymentGatewayId?: string
      /** The same rail as `<defId>:<id>`, the shape the payout's RELATIONSHIP pointer is written in. */
      paymentGatewayRecordId?: string
      clearingGlAccountId?: string
      feeGlAccountId?: string
      feeTreatment: PaymentGatewayFeeTreatmentValue
      reason: string
    }
  | {
      blockedReason: string
      paymentGatewayId?: never
      paymentGatewayRecordId?: never
      clearingGlAccountId?: never
      feeGlAccountId?: never
      feeTreatment?: never
      reason?: never
    }

/**
 * Resolve the rail a payout credits from its source context, or name why it
 * cannot be posted (brief 26 §3, §13 decision 2).
 *
 * ## The three answers
 *
 * - **`rail` set.** Its clearing account, its fee account (when it names one)
 *   and its fee treatment. A record with a blank clearing account falls back to
 *   the role rather than posting to `''`; `assertClearingAccount` makes that
 *   unreachable from the write path, it is reachable from a hand-edited row.
 * - **`rail` null, nothing conflicting.** The role fallback: the builder uses
 *   `clearing_card` and `payment_processing_fees`, which is precisely what
 *   every org did before brief 26. Only the Stripe source produces this.
 * - **`conflictingRails`.** 🛑 A REFUSAL, stamped as `payout_blocked_reason`
 *   the same way an unresolvable destination is. Never a silent fall back to
 *   the role: a wrong clearing account is invisible and permanent, a blocked
 *   payout is visible and fixable.
 *
 * The sentences name the source by its settlement-source label (`Stripe`,
 * `Shopify Payments`), so a Stripe payout reads exactly as it did when this
 * function knew only Stripe.
 */
export function resolvePayoutRail(
  ctx: Pick<PayoutSourceCtx, 'sourceId' | 'rail' | 'conflictingRails'>,
  payoutNumber: string
): ResolvedPayoutGateway {
  const label = PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS[ctx.sourceId]

  if (ctx.conflictingRails.length > 1) {
    const named = ctx.conflictingRails.map((row) => row.name || row.id).join(', ')
    return {
      blockedReason:
        `Payout ${payoutNumber} cannot name a clearing account: ${ctx.conflictingRails.length} payment ` +
        `gateways settle through ${label} (${named}), so there is no single rail this deposit ` +
        `drains. Leave one of them on ${label} on Accounting > Settings > Payment gateways.`,
    }
  }

  const rail = ctx.rail
  if (!rail) {
    return {
      blockedReason: null,
      feeTreatment: 'netted',
      reason: `Credited by the card clearing role because no gateway record claims the ${label} rail.`,
    }
  }

  const railName = rail.name || rail.id
  return {
    blockedReason: null,
    paymentGatewayId: rail.id,
    paymentGatewayRecordId: rail.recordId,
    ...(rail.clearingGlAccountId ? { clearingGlAccountId: rail.clearingGlAccountId } : {}),
    ...(rail.feeGlAccountId ? { feeGlAccountId: rail.feeGlAccountId } : {}),
    feeTreatment: rail.feeTreatment,
    reason: rail.clearingGlAccountId
      ? `Credited because the ${railName} gateway record settles through ${label} and names this as its clearing account.`
      : `Credited by the card clearing role because the ${railName} gateway record settles through ${label} but names no clearing account.`,
  }
}
