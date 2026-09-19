// packages/lib/src/accounting/money/cash-endpoint.ts

/**
 * Where a movement's money physically sits, as one GL account.
 *
 * ```
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
import { UnprocessableEntityError } from '../../errors'
import { ACCOUNT_ROLES } from '../ledger/builders/entry'
import { resolveBankAccountGlAccountInTx } from '../ledger/chart/resolve-cash-account'
import { resolveRoles } from '../ledger/roles/resolve-roles'
import type { CashEndpointKind, CashEndpointSource } from './client'
import { validateCashEndpointSource } from './client'

export type { CashEndpointKind, CashEndpointSource } from './client'

export interface CashEndpoint {
  glAccountId: string
  kind: CashEndpointKind
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
  validateCashEndpointSource(source)

  const railId = source.paymentGatewayId?.trim() || null
  if (railId) {
    const roles = await resolveRoles(tx, organizationId, [ACCOUNT_ROLES.CLEARING], {
      rail: railId,
      currency: source.currency,
    })
    if (roles.isErr()) throw new UnprocessableEntityError(`${subject}: ${roles.error.message}`)
    const clearing = roles.value.get(ACCOUNT_ROLES.CLEARING)
    if (!clearing)
      throw new UnprocessableEntityError(`${subject} payment gateway has no clearing account`)
    return { glAccountId: clearing.glAccountId, kind: 'clearing', railId }
  }

  const bankAccountInstanceId = source.cashAccountInstanceId?.trim() || null
  if (bankAccountInstanceId) {
    const glAccountId = await resolveBankAccountGlAccountInTx(
      tx,
      organizationId,
      bankAccountInstanceId,
      subject
    )
    return { glAccountId, kind: 'bank_account', railId: null }
  }

  const roles = await resolveRoles(tx, organizationId, [ACCOUNT_ROLES.UNDEPOSITED_FUNDS])
  if (roles.isErr()) throw new UnprocessableEntityError(`${subject}: ${roles.error.message}`)
  const undeposited = roles.value.get(ACCOUNT_ROLES.UNDEPOSITED_FUNDS)
  if (!undeposited)
    throw new UnprocessableEntityError(`${subject} undeposited funds account is not mapped`)
  return { glAccountId: undeposited.glAccountId, kind: 'undeposited_funds', railId: null }
}

/** The endpoint columns of a movement row, for {@link resolveCashEndpoint}. */
export function cashEndpointSourceOf(
  money: typeof schema.MoneyTransaction.$inferSelect
): CashEndpointSource {
  return {
    paymentGatewayId: money.paymentGatewayId,
    cashAccountInstanceId: money.cashAccountInstanceId,
    currency: money.currency,
  }
}
