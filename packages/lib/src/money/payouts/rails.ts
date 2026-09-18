// packages/lib/src/money/payouts/rails.ts

/**
 * The per-rail strip on Banking > Payouts
 * (`plans/accounting/tasks/27-a-settlement-from-anywhere.md` §8.2).
 *
 * One row per `payment_gateway` that names a clearing account: the account,
 * what is posted to it, when the rail last settled, when its fee was last
 * booked, and how it is relieved. Closed rails stay on the strip while their
 * account still holds a balance, because a closed rail winding down to zero is
 * a correct end state that a person should be able to watch (26 §9).
 *
 * ## 🛑 The balance is the ACCOUNT's, never the rail's
 *
 * Nothing stamps a gateway onto a `GlPostingLine` (26 §9.1), so the only
 * knowable figure is what is posted to the account the rail points at. Two
 * rails sharing one clearing account get the SAME balance and `sharedWith`
 * names the other, so the screen can say so rather than present one number
 * twice as two per-rail figures (27 §10.2, test 6).
 *
 * ## 🛑 "Clearing balance", never "unsettled"
 *
 * Until brief 29 moves the clearing debit to the payment date, the balance is
 * shipped-not-settled MINUS settled-not-shipped (27 §1.7) - a net of two
 * queues, not what the processor holds. The row carries a `balanceMinor` and
 * the screen labels it "Clearing balance"; the wording may change only in
 * brief 29's own change (27 §10.3).
 *
 * ## ⚠️ Derived, not stamped
 *
 * `lastSettledAt` is the gateway's hand-entered `lastSettlementAt` or the
 * latest paid payout the sync recorded for that rail, whichever is later. Every
 * payout raised since task 58 §5.5 carries its own `paymentGateway` pointer; the
 * `stripe`-settlementSource fallback below only ever attributes a payout raised
 * before that pointer existed. `lastFeeBookedAt` is read off the rail's OWN fee
 * account through `readRailFeeStatus`, and falls back to the stamped field for a
 * closed rail that read excludes.
 *
 * No permission checks here. The router asserts `ledgerView`
 * (`docs/lib-module-guide.md` §6).
 */

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import type {
  PaymentGatewayFeeTreatmentValue,
  PaymentGatewaySettlementSourceValue,
  PaymentGatewayStatusValue,
} from '../../accounting/rails/client'
import { readRailFeeStatus } from '../../accounting/rails/rail-fee-status'
// 🛑 The leaves, never `../../payment-gateways` - the barrel re-exports
// `writes.ts`, which imports `postings/chart-accounts`, and this module sits
// under `postings/` consumers already. Same call `rail-fee-status.ts` makes.
import { listPaymentGateways } from '../../accounting/rails/reads'
import { readClearingAccountBalance } from '../../accounting/rails/repoint'
import { guard } from './guard'
import { listPayouts } from './reads'

/** How many recent paid payouts to scan for the latest settlement date. */
const RECENT_PAID_PAYOUTS = 50

/** One row of the strip. Every money figure is integer minor units. */
export interface RailStripRow {
  paymentGatewayId: string
  /** The record's own name - `'Authorize.net'`. */
  name: string
  status: PaymentGatewayStatusValue
  feeTreatment: PaymentGatewayFeeTreatmentValue
  /** How the rail is relieved: an API source, or by hand in the review queue. */
  settlementSource: PaymentGatewaySettlementSourceValue
  /** The `gl_account` id the rail settles into. The screen names THIS, never only the rail. */
  clearingGlAccountId: string
  /**
   * Names of the OTHER rails pointing at the same clearing account. Non-empty
   * means `balanceMinor` is the account's figure and cannot be attributed to
   * this rail alone.
   */
  sharedWith: string[]
  /** Debits minus credits on the clearing account, asset-normal. */
  balanceMinor: number
  /** `YYYY-MM-DD`, or null when nothing has ever settled or been stamped. */
  lastSettledAt: string | null
  /**
   * `YYYY-MM-DD` of the last fee posted to the rail's OWN fee account, or the
   * stamped field, or null. Meaningful for a `billed` rail only; a netted rail's
   * fee rides inside every payout entry.
   */
  lastFeeBookedAt: string | null
  /**
   * The rail's fees land in an account something else books into as well, so
   * "when did this rail last bill us" cannot be answered (26 §5). The screen
   * says so rather than quoting a date.
   */
  feeAccountShared: boolean
}

/**
 * Every rail with a clearing account, active first, closed rails included while
 * their account holds a balance.
 *
 * Four reads and one balance query per DISTINCT clearing account: the gateways,
 * the balance of each account they name, the fee status of the active rails,
 * and the recent paid payouts. Never a query per rail for a shared account -
 * two rails on `1200` ask once.
 */
export async function listRailStrip(
  db: Database,
  params: { organizationId: string }
): Promise<Result<RailStripRow[], Error>> {
  const { organizationId } = params
  return guard(
    async () => {
      const gateways = await listPaymentGateways(db, organizationId)
      if (gateways.isErr()) throw gateways.error
      const routed = gateways.value.filter((gateway) => !!gateway.clearingGlAccountId.trim())
      if (routed.length === 0) return []

      const accountIds = [...new Set(routed.map((gateway) => gateway.clearingGlAccountId.trim()))]
      const balances = new Map<string, number>()
      await Promise.all(
        accountIds.map(async (glAccountId) => {
          const balance = await readClearingAccountBalance(db, { organizationId, glAccountId })
          if (balance.isErr()) throw balance.error
          balances.set(glAccountId, balance.value.balanceMinor)
        })
      )

      const feeStatus = await readRailFeeStatus(db, {
        organizationId,
        month: currentMonthKey(),
      })
      if (feeStatus.isErr()) throw feeStatus.error
      const feesByRail = new Map(feeStatus.value.map((rail) => [rail.paymentGatewayId, rail.fees]))

      const latestPaidAt = await readLatestPaidPayoutDate(db, organizationId)
      // Legacy fallback for a payout raised before task 58 §5.5 stamped every
      // rail's own pointer: two `stripe` records attribute nothing rather than
      // guess which one an unstamped row belongs to.
      const stripeRails = routed.filter((gateway) => gateway.settlementSource === 'stripe')
      const stripeRailId = stripeRails.length === 1 ? stripeRails[0]?.id : undefined

      const rows: RailStripRow[] = []
      for (const gateway of routed) {
        const clearingGlAccountId = gateway.clearingGlAccountId.trim()
        const balanceMinor = balances.get(clearingGlAccountId) ?? 0
        if (gateway.status === 'closed' && balanceMinor === 0) continue

        const fees = feesByRail.get(gateway.id)
        const settledAt = laterDateKey(
          gateway.lastSettlementAt,
          gateway.id === stripeRailId ? latestPaidAt : null
        )
        rows.push({
          paymentGatewayId: gateway.id,
          name: gateway.name || gateway.id,
          status: gateway.status,
          feeTreatment: gateway.feeTreatment,
          settlementSource: gateway.settlementSource,
          clearingGlAccountId,
          sharedWith: routed
            .filter(
              (other) =>
                other.id !== gateway.id && other.clearingGlAccountId.trim() === clearingGlAccountId
            )
            .map((other) => other.name || other.id),
          balanceMinor,
          lastSettledAt: settledAt,
          lastFeeBookedAt:
            fees?.kind === 'own'
              ? (fees.lastBookedAt ?? gateway.lastFeeBookedAt)
              : gateway.lastFeeBookedAt,
          feeAccountShared: fees?.kind === 'shared',
        })
      }

      // Active first, then by name: the live rails are what the page is read
      // for, and a closed rail winding down belongs under them.
      return rows.sort(
        (a, b) =>
          Number(a.status === 'closed') - Number(b.status === 'closed') ||
          a.name.localeCompare(b.name)
      )
    },
    'Failed to read the payout rail strip',
    { organizationId }
  )
}

/**
 * `YYYY-MM-DD` of the latest PAID payout on record, or null.
 *
 * `listPayouts` orders on `createdAt`, not `paidAt`, so the most recent page is
 * scanned for the maximum rather than trusting its first row: a late-synced
 * older payout can be created after a newer one.
 */
async function readLatestPaidPayoutDate(
  db: Database,
  organizationId: string
): Promise<string | null> {
  const paid = await listPayouts(db, { organizationId, status: 'paid', limit: RECENT_PAID_PAYOUTS })
  if (paid.isErr()) throw paid.error
  let latest: string | null = null
  for (const payout of paid.value) {
    latest = laterDateKey(latest, payout.paidAt)
  }
  return latest
}

/** The later of two `YYYY-MM-DD` keys; string comparison is a date comparison for them. */
function laterDateKey(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

/** `'2026-09'` for today, in UTC. Only bounds a field the strip does not read. */
function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7)
}
