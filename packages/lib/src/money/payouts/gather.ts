// packages/lib/src/money/payouts/gather.ts

/**
 * The READ half of the payout sync: what Stripe says a payout settled, and
 * which of it auxx has a payment for.
 *
 * Reads only - it creates no record and posts nothing. `sync.ts` is what writes.
 * The arithmetic itself is in `client.ts` and is pure, so the interesting rules
 * are testable without a Stripe double.
 *
 * ## Why this is reachable with no new credentials
 *
 * `PaymentAccount.stripeAccountId` is stored per org and every merchant-facing
 * call already runs on the PLATFORM key with a per-request `{ stripeAccount }`
 * header (`money/payments/connect-client.ts`). `payouts.list` and
 * `balanceTransactions.list({ payout })` are the same shape as every other
 * Connect call this codebase makes.
 *
 * 🛑 **The fee this reads is the PROCESSOR's, from the balance transaction.**
 * `money/payments/fees.ts` is the Connect APPLICATION fee - auxx's own cut - and
 * is a different number entirely. Task 01 §1.3's "reuse it, do not recompute"
 * points at the wrong file; `implementation-review.md` §1 corrects it.
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import type Stripe from 'stripe'
import { getStripeConnectClient } from '../payments/connect-client'
import { type PayoutItem, type PayoutSplit, splitPayout } from './client'

const logger = createScopedLogger('payouts:gather')

/**
 * How many balance transactions one page pulls. Stripe's ceiling is 100 and a
 * busy day's payout can hold thousands, so the walk below pages rather than
 * assuming one call is enough - a truncated read would silently move charges to
 * the unrecognised side and credit `2450` with money auxx does in fact know
 * about.
 */
const PAGE_SIZE = 100

/**
 * A payout as auxx sees it: the gateway's own numbers, plus the split.
 */
export interface GatheredPayout {
  /** The gateway's payout id, `po_…`. */
  payoutId: string
  /** `YYYY-MM-DD` in UTC - the date the money reached the bank. */
  paidAt: string
  /** Lowercase, as the gateway reports it. */
  currency: string
  /** The WHOLE transfer that reached the bank, integer minor units. */
  depositedMinor: number
  /** Stripe's own status: `paid`, `in_transit`, `failed`, `canceled`. */
  gatewayStatus: string
  /**
   * The Stripe external-account id this payout settled to (brief 13 §2.3),
   * or `null` when Stripe reports none. `payout.destination` is a string when
   * not expanded (the ordinary case here - this gatherer never expands it)
   * and an object with its own `id` when it is; either shape resolves to the
   * bare id. Never Stripe's `last4` - see `sync.ts` on why.
   */
  destination: string | null
  split: PayoutSplit
}

/**
 * Pull one payout's balance transactions and split them against the payments
 * auxx holds.
 *
 * ⚠️ **`depositedMinor` is transcribed from `payout.amount`, never summed from
 * the items.** Summing would silently correct the gateway's arithmetic, which is
 * the one thing that makes a clearing account impossible to reconcile - and it
 * is also what the cash leg must equal for the bank line to match.
 */
export async function gatherPayout(
  db: Database,
  params: { organizationId: string; stripeAccountId: string; payout: Stripe.Payout }
): Promise<GatheredPayout> {
  const { organizationId, stripeAccountId, payout } = params

  const items = await readPayoutItems(stripeAccountId, payout.id)
  const chargeIds = items.map((item) => item.chargeId).filter((id): id is string => id !== null)
  const recognised = await readRecognisedChargeIds(db, organizationId, chargeIds)
  const split = splitPayout(items, recognised)

  logger.info('Gathered a payout', {
    organizationId,
    payoutId: payout.id,
    items: items.length,
    recognisedGrossMinor: split.grossMinor,
    unrecognisedCount: split.unrecognisedCount,
  })

  return {
    payoutId: payout.id,
    paidAt: toIsoDay(payout.arrival_date),
    currency: payout.currency,
    depositedMinor: payout.amount,
    gatewayStatus: payout.status,
    destination: resolveDestinationId(payout.destination),
    split,
  }
}

/**
 * The bare external-account id off `payout.destination`, whatever shape it
 * arrived in. A string when unexpanded (this gatherer never expands it); an
 * object carrying its own `id` when a future caller does.
 */
function resolveDestinationId(destination: Stripe.Payout['destination']): string | null {
  if (!destination) return null
  return typeof destination === 'string' ? destination : destination.id
}

/**
 * Every balance transaction in one payout, reduced to {@link PayoutItem}.
 *
 * 🛑 Paged to exhaustion. A truncated read is not a smaller answer, it is a
 * WRONG one: the charges it missed fall to the unrecognised side, `2450` is
 * credited with money auxx has a payment for, and clearing is left holding a
 * balance that will never drain.
 */
async function readPayoutItems(stripeAccountId: string, payoutId: string): Promise<PayoutItem[]> {
  const stripe = getStripeConnectClient()
  const items: PayoutItem[] = []
  let startingAfter: string | undefined

  for (;;) {
    const page: Stripe.ApiList<Stripe.BalanceTransaction> = await stripe.balanceTransactions.list(
      {
        payout: payoutId,
        limit: PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      { stripeAccount: stripeAccountId }
    )

    for (const txn of page.data) {
      // The payout itself appears in its own balance-transaction list as the
      // `payout` type. Counting it would double the whole deposit.
      if (txn.type === 'payout') continue
      items.push({
        id: txn.id,
        chargeId: resolveChargeId(txn),
        grossMinor: txn.amount,
        // Stripe reports the fee as a positive number withheld; the entry wants
        // it positive too, and `direction` carries the sign.
        feeMinor: txn.fee,
      })
    }

    if (!page.has_more) break
    const last = page.data.at(-1)
    if (!last) break
    startingAfter = last.id
  }

  return items
}

/**
 * The charge a balance transaction settled, when it settled one.
 *
 * `source` is an id string or an expanded object depending on the call; this
 * never expands, so the string branch is the live one and the object branch is
 * defensive. A `charge` type carries the charge directly; a `refund` carries the
 * refund, whose `charge` is what matters - but an unexpanded refund source is
 * just `re_…`, so a refund is matched through the `PaymentTransaction` refund
 * column instead (see {@link readRecognisedChargeIds}).
 */
function resolveChargeId(txn: Stripe.BalanceTransaction): string | null {
  const source = txn.source
  if (!source) return null
  const id = typeof source === 'string' ? source : source.id
  return id.startsWith('ch_') || id.startsWith('py_') || id.startsWith('re_') ? id : null
}

/**
 * Which of these gateway ids auxx holds a `PaymentTransaction` for.
 *
 * ⚠️ **Refund rows are included deliberately.** A refund inside a payout is a
 * negative item that belongs on the same side as its charge; leaving it
 * unrecognised would credit `unidentified_receipts` with a negative and relieve
 * clearing of more than was ever debited to it. `stripeRefundId` is the column
 * that matches `re_…`.
 *
 * ⚠️ **Status is not filtered.** A `PaymentTransaction` that reached a payout
 * settled, whatever auxx's mirror of its status says; filtering on `succeeded`
 * would push a row whose webhook is late or lost to the unrecognised side and
 * misstate two accounts at once.
 */
async function readRecognisedChargeIds(
  db: Database,
  organizationId: string,
  gatewayIds: string[]
): Promise<Set<string>> {
  if (gatewayIds.length === 0) return new Set()

  const rows = await db
    .select({
      chargeId: schema.PaymentTransaction.stripeChargeId,
      refundId: schema.PaymentTransaction.stripeRefundId,
    })
    .from(schema.PaymentTransaction)
    .where(
      and(
        eq(schema.PaymentTransaction.organizationId, organizationId),
        isNotNull(schema.PaymentTransaction.provider),
        inArray(schema.PaymentTransaction.stripeChargeId, gatewayIds)
      )
    )

  const refunds = await db
    .select({ refundId: schema.PaymentTransaction.stripeRefundId })
    .from(schema.PaymentTransaction)
    .where(
      and(
        eq(schema.PaymentTransaction.organizationId, organizationId),
        inArray(schema.PaymentTransaction.stripeRefundId, gatewayIds)
      )
    )

  const found = new Set<string>()
  for (const row of rows) if (row.chargeId) found.add(row.chargeId)
  for (const row of refunds) if (row.refundId) found.add(row.refundId)
  return found
}

/** Stripe reports `arrival_date` as UNIX seconds; the ledger dates in `YYYY-MM-DD`. */
function toIsoDay(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}
