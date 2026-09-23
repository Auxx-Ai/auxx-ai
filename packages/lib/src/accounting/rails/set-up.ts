// packages/lib/src/accounting/rails/set-up.ts

/**
 * One call that sets a rail up the way the gateway editor shows it: accounts, record, bank, feed
 * (plans/accounting/tasks/100-blocked-names-what-to-fix.md §3.2).
 *
 * Not one transaction: `setRoleAssignment` and the entity create each open their own, the gap
 * `createPaymentGateway` already documents. Everything up to the record refuses; a bank or feed
 * step that fails after it comes back in `failures` beside the gateway, which stands.
 *
 * No permission checks. The router asserts `ledgerControl` (`docs/lib-module-guide.md` §6).
 */

import type { Database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { ACCOUNT_ROLES } from '../ledger/builders/entry'
import { setRoleAssignment } from '../ledger/roles/role-map'
import type {
  PaymentGatewayFeeTreatmentValue,
  PaymentGatewayRow,
  PaymentGatewayStatusValue,
} from './client'
import { linkFeed } from './feeds'
import { mintRailAccounts, mintRailFeeAccount } from './mint-rail-accounts'
import { createPaymentGateway } from './writes'

/** An existing chart account, or a new one minted under this name. */
export type RailAccountChoice = { accountId: string } | { mint: string }

/** What `setUpPaymentGateway` accepts. */
export interface SetUpPaymentGatewayInput {
  organizationId: string
  actorUserId: string
  name: string
  handles: string[]
  feeTreatment?: PaymentGatewayFeeTreatmentValue
  status?: PaymentGatewayStatusValue
  clearing: RailAccountChoice
  /** Absent or null inherits the org's `payment_processing_fees` account. */
  fee?: RailAccountChoice | null
  /** The rail-scoped `bank` role. */
  bankAccountId?: string | null
  /** A `FinancialSourceAccount` to link, as `listUnlinkedFeeds` offers it. */
  sourceAccountId?: string | null
}

/** A step after the record was written that did not land. */
export interface SetUpFailure {
  step: 'bank' | 'feed'
  message: string
}

export interface SetUpPaymentGatewayResult {
  gateway: PaymentGatewayRow
  failures: SetUpFailure[]
}

/** Mint what was asked for, write the gateway, then map its bank and link its feed. */
export async function setUpPaymentGateway(
  db: Database,
  input: SetUpPaymentGatewayInput
): Promise<Result<SetUpPaymentGatewayResult, Error>> {
  const { organizationId, actorUserId } = input
  const feeMint = input.fee && 'mint' in input.fee ? input.fee.mint : null

  let clearingAccountId: string
  let feeAccountId: string | null =
    input.fee && 'accountId' in input.fee ? input.fee.accountId : null
  if ('mint' in input.clearing) {
    const minted = await mintRailAccounts(db, {
      organizationId,
      actorUserId,
      clearingAccountName: input.clearing.mint,
      mintFeeAccount: feeMint !== null,
      feeAccountName: feeMint ?? undefined,
    })
    if (minted.isErr()) return err(minted.error)
    clearingAccountId = minted.value.clearing.id
    if (minted.value.fee) feeAccountId = minted.value.fee.id
  } else {
    clearingAccountId = input.clearing.accountId
    if (feeMint !== null) {
      const fee = await mintRailFeeAccount(db, {
        organizationId,
        actorUserId,
        feeAccountName: feeMint,
      })
      if (fee.isErr()) return err(fee.error)
      feeAccountId = fee.value.id
    }
  }

  const created = await createPaymentGateway(db, {
    organizationId,
    actorUserId,
    name: input.name,
    handles: input.handles,
    clearingAccountId,
    feeAccountId,
    feeTreatment: input.feeTreatment,
    status: input.status,
  })
  if (created.isErr()) return err(created.error)
  const gateway = created.value

  const failures: SetUpFailure[] = []
  if (input.bankAccountId) {
    const bank = await setRoleAssignment(db, {
      organizationId,
      role: ACCOUNT_ROLES.BANK,
      paymentGatewayId: gateway.id,
      glAccountId: input.bankAccountId,
      actorUserId,
    })
    if (bank.isErr()) failures.push({ step: 'bank', message: bank.error.message })
  }
  if (input.sourceAccountId) {
    const feed = await linkFeed(db, {
      organizationId,
      actorUserId,
      gatewayId: gateway.id,
      sourceAccountId: input.sourceAccountId,
    })
    if (feed.isErr()) failures.push({ step: 'feed', message: feed.error.message })
  }

  return ok({ gateway, failures })
}
