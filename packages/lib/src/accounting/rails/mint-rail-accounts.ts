// packages/lib/src/accounting/rails/mint-rail-accounts.ts

/**
 * Mint the chart accounts one payment rail needs: a clearing account always,
 * and a merchant fee account when the caller asks for one
 * (`plans/accounting/tasks/26-a-clearing-account-per-rail.md` §7).
 *
 * ## 🛑 Not inside `createPaymentGateway`, and this is load-bearing
 *
 * That function's own jsdoc states *"What it must NOT do: mint an account per
 * gateway"*, and §7.4 keeps it true: `clearingAccountId` there names an
 * EXISTING account, two rails sharing one clearing account stays ordinary, and
 * brief 13 §5.3's rule - *"the record says which account, it does not demand a
 * new one"* - is unchanged. So the mint is its OWN door. A composed router
 * procedure calls this and then the gateway writer, which gives the UI one
 * click and leaves the lib contract where it was.
 *
 * ## 🛑 Minted accounts get NO role, and there is no parameter for one
 *
 * This is the rule that killed `clearing_affirm` on 2026-09-10
 * (`build-entry.ts:86`: *"a role must not name a vendor"*), and `1210 Affirm
 * Clearing` left the `card_rail` pack in the same pass. `ACCOUNT_ROLES` is a
 * CLOSED vocabulary tied to builders, so a role minted per rail would name
 * nothing a builder emits - and the one role that does route a rail,
 * `clearing`, is the FALLBACK every unrouted handle lands on. An account minted
 * here is named by a rail-scoped `GlRoleAssignment` row (58 §5.1), and by
 * nothing else - the gateway record carries no account fields.
 *
 * ⚠️ The account is not left unprotected by being role-less. `assertNoLiveRole`
 * (`chart-write.ts`) refuses to archive or deactivate an account a role
 * assignment still names, which is the guard for precisely this shape.
 *
 * ## What it does not do
 *
 * It does not create, update or look at a `payment_gateway` record, and it does
 * not decide whether a fee account is wanted - `mintFeeAccount` is the caller's
 * answer. §5's asymmetric defaults (a `netted` rail books to the shared `6100`
 * fallback, a `billed` rail mints its own) are a checkbox default on the wizard
 * page, not a rule this function may apply on somebody's behalf.
 *
 * No permission checks here. The router asserts `ledgerControl`
 * (`docs/lib-module-guide.md` §6) - the same rung `chartAccountCreate` sits on,
 * for the same reason: this decides where real money lands.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, BadRequestError } from '../../errors'
import { createChartAccount } from '../../postings/chart-write'
import {
  CLEARING_ACCOUNT_CODE_BAND,
  MERCHANT_FEE_ACCOUNT_CODE_BAND,
} from '../../postings/default-chart'
import { nextAccountCode } from '../../postings/next-account-code'
import { listChartAccounts } from '../../postings/role-map'
import type { ChartAccountRow } from '../../postings/types'
import { GlAccountType } from '../../resources/registry/enum-values'

const logger = createScopedLogger('postings:mint-rail-accounts')

/** What {@link mintRailAccounts} accepts. */
export interface MintRailAccountsInput {
  organizationId: string
  /** Who pressed the button. Attributed on both writes - never a system session. */
  actorUserId: string
  /**
   * What to call the clearing account, e.g. `'Shopify Payments Clearing'`.
   *
   * Suggested by `suggestRail` (`@auxx/lib/accounting/rails/rail-catalogue`)
   * and then edited by a person. Taken as a plain string rather than derived
   * from a handle here so that `postings/` does not import `payment-gateways/`,
   * which imports `postings/chart-accounts` already.
   */
  clearingAccountName: string
  /**
   * Mint a dedicated merchant fee account as well.
   *
   * A plain boolean, decided by the caller. `false` means this rail's fees book
   * to whatever account holds `payment_processing_fees` - `6100` in the default
   * chart - which is the right answer for a `netted` rail and the wrong one for
   * a `billed` rail (§5), but that is the wizard's call and not this one's.
   */
  mintFeeAccount: boolean
  /** What to call the fee account. Required when `mintFeeAccount` is true. */
  feeAccountName?: string
}

/** The accounts that were created. Their ids are what the gateway record points at. */
export interface MintedRailAccounts {
  /** Always created. An ASSET account, active, role-less. */
  clearing: ChartAccountRow
  /** An EXPENSE account, or null when `mintFeeAccount` was false. */
  fee: ChartAccountRow | null
}

/**
 * Create one rail's accounts and hand back the rows.
 *
 * Both codes are allocated and both names are checked BEFORE either write, so
 * the band-full refusal and the blank-name refusal cannot leave a half-minted
 * pair behind. ⚠️ The two creates are still two writes and not one transaction:
 * if the second fails on something infrastructural the clearing account stands,
 * which is the safe half to keep - it is the one the gateway record needs, and
 * the fee account can be added from the chart editor.
 *
 * @returns the two rows, or the first refusal. `AuxxError` subclasses only.
 */
export async function mintRailAccounts(
  db: Database,
  input: MintRailAccountsInput
): Promise<Result<MintedRailAccounts, Error>> {
  const { organizationId, actorUserId, mintFeeAccount } = input

  const clearingAccountName = input.clearingAccountName.trim()
  if (!clearingAccountName) {
    return err(new BadRequestError('The clearing account needs a name.', { organizationId }))
  }

  const feeAccountName = input.feeAccountName?.trim() ?? ''
  if (mintFeeAccount && !feeAccountName) {
    return err(new BadRequestError('The fee account needs a name.', { organizationId }))
  }

  // Live accounts only, archived excluded - `nextAccountCode`'s header has why
  // that matches the uniqueness gate the write itself applies.
  const chart = await listChartAccounts(db, organizationId)
  if (chart.isErr()) return err(chart.error)

  const clearingCode = nextAccountCode(CLEARING_ACCOUNT_CODE_BAND, chart.value)
  if (clearingCode.isErr()) return err(clearingCode.error)

  const feeCode = mintFeeAccount
    ? nextAccountCode(MERCHANT_FEE_ACCOUNT_CODE_BAND, chart.value)
    : ok(null)
  if (feeCode.isErr()) return err(feeCode.error)

  // 🛑 No `role` key on either call, and none reachable from this module's
  // input. See the file header.
  const clearing = await createChartAccount(db, {
    organizationId,
    actorUserId,
    code: clearingCode.value,
    name: clearingAccountName,
    accountType: GlAccountType.ASSET,
  })
  if (clearing.isErr()) return err(clearing.error)

  if (!mintFeeAccount) return ok({ clearing: clearing.value, fee: null })

  const fee = await createChartAccount(db, {
    organizationId,
    actorUserId,
    code: feeCode.value,
    name: feeAccountName,
    accountType: GlAccountType.EXPENSE,
  })
  if (fee.isErr()) {
    logger.error('Minted a rail clearing account but not its fee account', {
      organizationId,
      clearingAccountId: clearing.value.id,
      error: fee.error,
    })
    return err(
      fee.error instanceof AuxxError
        ? fee.error
        : new AuxxError('Internal error', { organizationId })
    )
  }

  return ok({ clearing: clearing.value, fee: fee.value })
}
