// packages/lib/src/money/payouts/types.ts

import type { PayoutSourceValue, PayoutStatus } from './client'
import type { PayoutSourceSummary } from './source-reads'

export type { PayoutSourceValue } from './client'

/** One payout row as every read path returns it. */
export interface PayoutRecord {
  /** Ordinary mapped source fields, kept separate from accepted accounting values. */
  reportedFields?: Record<string, string | number | null>
  sourceSummary?: PayoutSourceSummary | null
  payoutId: string
  /** `<defId>:<instanceId>`, for a record link. */
  recordId: string
  /** `PAY-0001`. Null only if the number hook did not run, which cannot happen. */
  number: string | null
  /** The gateway's own id, `po_…`. */
  gatewayId: string | null
  status: PayoutStatus
  /** `YYYY-MM-DD`, or null while the payout is still in transit. */
  paidAt: string | null
  currency: string | null
  /** The whole transfer that reached the bank, integer minor units. */
  depositedMinor: number
  /** Recognised gross - what was relieved from card clearing. */
  grossMinor: number
  /** What the PROCESSOR withheld on the recognised charges. */
  feesMinor: number
  /** Recognised gross less recognised fees. */
  netMinor: number
  /** Settled charges auxx has no payment for, net. Zero is the ordinary case. */
  unrecognisedNetMinor: number
  unrecognisedCount: number
  /** The posting this payout became, or null while it has none. */
  glPostingId: string | null
  /**
   * Set when this payout could not be posted for lack of a confirmed
   * bank-account identity (brief 13 §2.3). Names the payout, the destination
   * and the remedy. Null once posted, or if it never blocked.
   */
  blockedReason: string | null
  /**
   * The bank line that confirmed this payout (brief 18 §1, the duplicate
   * detector's prevention half). Set only by `matchTransaction`
   * (`banking/review/writes.ts`) when a reviewer matches the payout to its
   * bank line; cleared by `undoReview`. A `paid` payout with no bank line yet
   * is a real signal on the payouts page - either the deposit has not landed
   * or somebody coded it by hand instead of matching it.
   */
  bankTransactionId: string | null
  /**
   * The `payment_gateway` record this payout settled (brief 27 §6.1) - the
   * routing key and half of the idempotency pair. Null on a payout raised
   * while no gateway record claimed the rail, or one written before the field
   * existed; the sync stamps it the next time it sees the payout.
   */
  paymentGatewayId: string | null
  /** The `bank_account` record the money landed in. Stamped when the entry posts. */
  bankAccountId: string | null
  /**
   * Set when the source reported a destination the mapped bank account's
   * `settlementDestinations` does not carry (58 §4.5, §5.4 rule 2, D7). The entry still posted -
   * distinct from {@link blockedReason}, which means nothing did.
   */
  destinationMismatch: string | null
  /**
   * Provenance. An `imported` payout has no itemisation, so its zero
   * unrecognised remainder means "nothing to split", never "everything
   * recognised" - the screen must say which (§4 rule 2).
   */
  source: PayoutSourceValue
  createdAt: Date
}

/** Filters `listPayouts` narrows on, applied in SQL. */
export interface ListPayoutsFilters {
  status?: PayoutStatus
  /** Only payouts that left something in `2450` - the queue somebody works. */
  onlyUnidentified?: boolean
  limit?: number
  offset?: number
}

/** What one `syncPayouts` run did. */
export interface SyncPayoutsResult {
  /** Payouts seen on the sources this run. */
  seen: number
  /** Payout records created. */
  created: number
  /** Entries posted. */
  posted: number
  /** Payouts skipped because they already carry a posting. */
  alreadyPosted: number
  /** Payouts the entry refused, with the reason. */
  refused: { payoutId: string; reason: string }[]
  /**
   * Source contexts that could not run at all - the provider unreachable, the
   * source unregistered - named by rail. A failed rail never stops the others
   * (brief 27 §7), so it is reported here rather than as the run's error.
   */
  failed: { sourceId: string; paymentGatewayId: string | null; reason: string }[]
}
