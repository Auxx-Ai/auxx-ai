// packages/lib/src/accounting/money/cash-endpoint.ts

/**
 * Where a movement's money physically sits, as one GL account.
 *
 * ```
 *   giftCard                  → the unscoped `gift_card_liability` role (91 D8)
 *   paymentGatewayId set      → the rail's clearing account, scoped by rail + currency
 *   cashAccountInstanceId set → the bank account's `bank_account_gl_account` pointer
 *   neither                   → the unscoped `undeposited_funds` role
 * ```
 *
 * 🔑 `undeposited_funds` is resolved UNSCOPED on purpose: a deposit run groups
 * across rails, which is the whole point of holding money there.
 *
 * Direction is the caller's — a receipt debits this account and a refund credits
 * it, so one function serves money in and money out.
 */

import type { schema, Transaction } from '@auxx/database'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { ACCOUNT_ROLES } from '../ledger/builders/entry'
import { resolveBankAccountGlAccountInTx } from '../ledger/chart/resolve-cash-account'
import { resolveRoles } from '../ledger/roles/resolve-roles'
import { withWorkItemCode } from '../work-items/refusal'
import type { CashEndpointKind, CashEndpointSource } from './client'
import { validateCashEndpointSource } from './client'

export type { CashEndpointKind, CashEndpointSource } from './client'

/** The role each endpoint kind resolves through; `bank` for a bank account's own pointer. */
export type CashEndpointRole =
  | typeof ACCOUNT_ROLES.CLEARING
  | typeof ACCOUNT_ROLES.UNDEPOSITED_FUNDS
  | typeof ACCOUNT_ROLES.BANK
  | typeof ACCOUNT_ROLES.GIFT_CARD_LIABILITY

export interface CashEndpoint {
  glAccountId: string
  kind: CashEndpointKind
  /** The role `glAccountId` holds, stamped beside it on the line as a snapshot (101 E8). */
  role: CashEndpointRole
  /** The rail, when `kind` is `clearing`. Goes onto `GlPosting.railId` and `scope.rail`. */
  railId: string | null
}

/** The GL account a movement's money sits in, or a refusal naming what is unmapped. */
export async function resolveCashEndpoint(
  tx: Transaction,
  organizationId: string,
  source: CashEndpointSource,
  /** Prefixes every refusal: 'Invoice receipt', 'Refund', 'Vendor payment'. */
  subject: string
): Promise<CashEndpoint> {
  const unresolved = (message: string, railId: string | null = null) =>
    new UnprocessableEntityError(message, withWorkItemCode('ENDPOINT_UNRESOLVED', { railId }))
  // An unmapped role is `ROLE_UNMAPPED`, so mapping it wakes the row (91 §4.6).
  const unmapped = (message: string, role: string, railId: string | null = null) =>
    new UnprocessableEntityError(message, withWorkItemCode('ROLE_UNMAPPED', { role, railId }))

  try {
    validateCashEndpointSource(source)
  } catch (error) {
    throw unresolved(error instanceof Error ? error.message : String(error))
  }

  if (source.giftCard) {
    const roles = await resolveRoles(tx, organizationId, [ACCOUNT_ROLES.GIFT_CARD_LIABILITY])
    if (roles.isErr()) throw unresolved(`${subject}: ${roles.error.message}`)
    const liability = roles.value.get(ACCOUNT_ROLES.GIFT_CARD_LIABILITY)
    if (!liability)
      throw unmapped(
        `${subject} gift card liability account is not mapped`,
        ACCOUNT_ROLES.GIFT_CARD_LIABILITY
      )
    return {
      glAccountId: liability.glAccountId,
      kind: 'gift_card',
      role: ACCOUNT_ROLES.GIFT_CARD_LIABILITY,
      railId: null,
    }
  }

  const railId = source.paymentGatewayId?.trim() || null
  if (railId) {
    const roles = await resolveRoles(tx, organizationId, [ACCOUNT_ROLES.CLEARING], {
      rail: railId,
      currency: source.currency,
    })
    if (roles.isErr()) throw unresolved(`${subject}: ${roles.error.message}`, railId)
    const clearing = roles.value.get(ACCOUNT_ROLES.CLEARING)
    if (!clearing)
      throw unmapped(
        `${subject} payment gateway has no clearing account`,
        ACCOUNT_ROLES.CLEARING,
        railId
      )
    return {
      glAccountId: clearing.glAccountId,
      kind: 'clearing',
      role: ACCOUNT_ROLES.CLEARING,
      railId,
    }
  }

  const bankAccountInstanceId = source.cashAccountInstanceId?.trim() || null
  if (bankAccountInstanceId) {
    try {
      const glAccountId = await resolveBankAccountGlAccountInTx(
        tx,
        organizationId,
        bankAccountInstanceId,
        subject
      )
      return { glAccountId, kind: 'bank_account', role: ACCOUNT_ROLES.BANK, railId: null }
    } catch (error) {
      if (!(error instanceof AuxxError)) throw error
      throw unresolved(error.message)
    }
  }

  const roles = await resolveRoles(tx, organizationId, [ACCOUNT_ROLES.UNDEPOSITED_FUNDS])
  if (roles.isErr()) throw unresolved(`${subject}: ${roles.error.message}`)
  const undeposited = roles.value.get(ACCOUNT_ROLES.UNDEPOSITED_FUNDS)
  if (!undeposited)
    throw unmapped(
      `${subject} undeposited funds account is not mapped`,
      ACCOUNT_ROLES.UNDEPOSITED_FUNDS
    )
  return {
    glAccountId: undeposited.glAccountId,
    kind: 'undeposited_funds',
    role: ACCOUNT_ROLES.UNDEPOSITED_FUNDS,
    railId: null,
  }
}

/**
 * The endpoint columns of a movement row, for {@link resolveCashEndpoint}. `giftCard` is the
 * caller's: it comes from the movement's own gateway handle, which no column stores.
 */
export function cashEndpointSourceOf(
  money: typeof schema.MoneyTransaction.$inferSelect,
  giftCard = false
): CashEndpointSource {
  return {
    paymentGatewayId: money.paymentGatewayId,
    cashAccountInstanceId: money.cashAccountInstanceId,
    currency: money.currency,
    ...(giftCard ? { giftCard } : {}),
  }
}
