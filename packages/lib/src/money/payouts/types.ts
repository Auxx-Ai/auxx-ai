// packages/lib/src/money/payouts/types.ts

import type { PayoutStatus } from './client'

/** One payout row as every read path returns it. */
export interface PayoutRecord {
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
  /** Payouts seen on the gateway this run. */
  seen: number
  /** Payout records created. */
  created: number
  /** Entries posted. */
  posted: number
  /** Payouts skipped because they already carry a posting. */
  alreadyPosted: number
  /** Payouts the entry refused, with the reason. */
  refused: { payoutId: string; reason: string }[]
}
