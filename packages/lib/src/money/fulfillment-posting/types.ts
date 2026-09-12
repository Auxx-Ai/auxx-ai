// packages/lib/src/money/fulfillment-posting/types.ts

/**
 * The contract the bulk fulfillment posting is written against.
 *
 * `plans/money/tasks/49-bulk-fulfillment-posting.md` §2.3, §2.5, §2.6, §8.
 *
 * This file is the seam between the halves of the feature and holds no logic:
 *
 * - `reads.ts` finds every unposted shipment in a range (the netting read),
 * - `plan.ts` is PURE and groups, excludes and totals them,
 * - `run.ts` posts one entry per group and stamps the shipments,
 * - `postings/build-fulfillment-batch-entry.ts` builds the entry for one group,
 * - the router and the dialog render it.
 *
 * The split follows `builds/backfill-types.ts` exactly, and for the same reason:
 * the decision has to be testable without a database, a clock or a settings read.
 *
 * Client-safe: types and constants only. No `@auxx/database` import.
 */

import { BATCH_POSTING_GROUPINGS, type BatchPostingGrouping } from '../batch-posting/types'

/**
 * How many shipments one posting summarises. One entry per group.
 *
 * An ALIAS of the vocabulary every bulk poster shares
 * (`money/batch-posting/types.ts`, brief 25 §5), kept under this name so every
 * call site reads in its own module's language. `'week'` was dropped on
 * 2026-09-11 (brief 25 §6.4) and the shared file records why it must not come
 * back.
 */
export type FulfillmentPostingGrouping = BatchPostingGrouping

export const FULFILLMENT_POSTING_GROUPINGS: readonly FulfillmentPostingGrouping[] =
  BATCH_POSTING_GROUPINGS

/**
 * Which account the entry debits for one shipment (49 §3.2, §8.4 decision 6).
 *
 * Decided per shipment from the order's financial status and gateways, never
 * from the channel. A card order was paid at checkout and the payout entry
 * drains clearing; a terms order owes, and aging names the debtor.
 *
 * 🛑 **`'gateway'`, added by brief 13 §5.3, is not a third account.** It is
 * the bucket a shipment falls into when its gateway resolved to a
 * `payment_gateway` record's own clearing account id rather than to one of the
 * two roles below - see {@link FulfillmentDebit}. Every non-card rail lands
 * here since `clearing_affirm` was deleted on 2026-09-10. `byDebitRole` summaries
 * (this file's own `FulfillmentPostingGroup.totals.byDebitRole` and the
 * builder's `BuiltFulfillmentBatchEntry.totals.byDebitRole`) keep working
 * unchanged by counting every id-based debit under this one key; the actual
 * account id rides on `ShipmentAmounts.debitGlAccountId`.
 */
export type FulfillmentDebitRole = 'clearing_card' | 'accounts_receivable' | 'gateway'

/**
 * What a shipment debits: a declared ROLE, or a `payment_gateway` record's own
 * clearing account id (brief 13 §5.3's contract - `build-entry.ts`'s header:
 * "a gateway does not get a role").
 */
export type FulfillmentDebit =
  | { role: Exclude<FulfillmentDebitRole, 'gateway'> }
  | { glAccountId: string }

/**
 * Why a shipment in the range produces no posting.
 *
 * Closed on purpose (44 §7.2b): a caller renders, counts and tests them
 * exhaustively rather than parsing a sentence. Every exclusion carries the
 * number or the value that proves its reason in {@link FulfillmentPostingExclusion.detail}.
 */
export type FulfillmentPostingExclusionReason =
  | 'before-cutoff'
  | 'locked-period'
  | 'foreign-currency'
  | 'gateway-ambiguous'
  | 'test-gateway'
  | 'zero-value'

export const FULFILLMENT_POSTING_EXCLUSION_REASONS: readonly FulfillmentPostingExclusionReason[] = [
  'before-cutoff',
  'locked-period',
  'foreign-currency',
  'gateway-ambiguous',
  'test-gateway',
  'zero-value',
]

/** One shipped line inside an unposted shipment, as the builder needs it. */
export interface UnpostedShipmentLine {
  lineId: string
  quantity: number
  /** Minor units per unit. A RATE, may be fractional. */
  unitPriceMinor: number
  /**
   * This line's tax for the whole line (`line_item_tax_total`), integer minor
   * units, when the provider supplied it. Null means not supplied, which is not
   * zero (48 §8.2). The builder allocates the order's tax when any line is null.
   */
  lineTaxMinor: number | null
  /** `line_item_qty`, so a partial-line shipment can scale `lineTaxMinor`. */
  orderedQuantity: number
  name?: string
}

/**
 * One shipment with no LIVE posting stamped (49 §2.2, §2.6 rule 1): the log
 * entry's `glPostingId` is null, or names a posting whose status is `reversed`.
 *
 * Everything the builder needs travels on it, so `plan.ts` and the builder see
 * no database.
 */
export interface UnpostedShipment {
  orderId: string
  orderNumber: string
  /** The log entry's `sequence`. The stamp is written back by `(orderId, sequence)`. */
  sequence: number
  /** `YYYY-MM-DD`, the log entry's `shippedAt`. The recognition date. */
  shippedAt: string
  lines: UnpostedShipmentLine[]
  /** `order_channel`, verbatim. Unknown values recognise as consumer revenue (§8.4 decision 5). */
  channel: string | null
  /** `order_currency`, verbatim. Blank reads as the ledger currency. */
  currency: string | null
  /** `order_financial_status`, verbatim. */
  financialStatus: string | null
  /** `order_payment_gateways`, verbatim, one entry per gateway. Casing as the provider sent it. */
  gateways: string[]
  /** `order_subtotal`, integer minor units. */
  orderSubtotalMinor: number
  /** `order_tax_total`, integer minor units. */
  orderTaxTotalMinor: number
  /** `order_shipping_total`, integer minor units. */
  orderShippingTotalMinor: number
  /** Σ `subtotalMinor` of every EARLIER shipment of this order, live or not. */
  priorShipmentsSubtotalMinor: number
  /** The log entry's `shippingRecognised`. Exactly one shipment per order carries it. */
  includeShipping: boolean
  /**
   * The order's contact. Screen-only until brief 13 §1.2, which made it the
   * counterparty `build-fulfillment-batch-entry.ts` freezes onto the per-order
   * `accounts_receivable` line - never onto a summarised line.
   */
  contactId: string | null
  /**
   * The order's own `tax_line` rows - one per jurisdiction (brief 13 §5).
   * Empty when the org has none, or the org predates entity migration for
   * `tax_line`. Used to split this shipment's `sales_tax_payable` credit
   * across jurisdictions when they tie to `orderTaxTotalMinor` - see
   * `postings/split-tax-by-jurisdiction.ts`.
   */
  taxLines: readonly { title: string; priceMinor: number }[]
}

/** Everything the pure plan is allowed to see. No db, no clock, no settings. */
export interface FulfillmentPostingPlanInput {
  shipments: readonly UnpostedShipment[]
  grouping: FulfillmentPostingGrouping
  /** `accounting.cutoffPeriod`, `YYYY-MM`, or null when unset. Shipments at or before it are excluded. */
  cutoffPeriod: string | null
  /** `ledger.lockedThroughMonth`, `YYYY-MM`, or null. Shipments in a locked month are excluded. */
  lockedThroughMonth: string | null
  /** The one currency the books are kept in. */
  ledgerCurrency: string
  /** `accounting.bookTimeZone`. Month buckets are cut in it. */
  timeZone: string
}

/** The amounts one shipment contributes, all integer minor units. */
export interface ShipmentAmounts {
  debitRole: FulfillmentDebitRole
  /**
   * The `payment_gateway` record's own clearing account id, set only when
   * `debitRole` is `'gateway'` (brief 13 §5.3). Absent for the three declared
   * roles.
   */
  debitGlAccountId?: string
  subtotalMinor: number
  taxMinor: number
  /**
   * `taxMinor` split across jurisdictions, when the order's own `tax_line`
   * rows tie to its total (brief 13 §5). Absent when there is nothing to
   * split or the split does not tie - the caller then credits `taxMinor` as
   * one undimensioned line, same as before this existed.
   */
  taxByJurisdiction?: Array<{ jurisdiction: string; amountMinor: number }>
  shippingMinor: number
  totalMinor: number
  taxBasis: 'per_line' | 'allocated'
}

/** One shipment inside a group, with what it will post. */
export interface PlannedShipment extends UnpostedShipment {
  amounts: ShipmentAmounts
}

/** One posting the run will make. */
export interface FulfillmentPostingGroup {
  /**
   * The group's identity and the posting's period key before any attempt
   * suffix: `2026-07-06` for a day, `2026-07` for a month.
   */
  groupKey: string
  /** `YYYY-MM-DD`. The latest `shippedAt` in the group. Never a future date. */
  txnDate: string
  shipments: PlannedShipment[]
  orderCount: number
  totals: {
    subtotalMinor: number
    taxMinor: number
    shippingMinor: number
    totalMinor: number
    /** The debit split, so the preview shows where the money is expected from. */
    byDebitRole: Record<FulfillmentDebitRole, number>
  }
}

export interface FulfillmentPostingExclusion {
  orderId: string
  orderNumber: string
  sequence: number
  shippedAt: string
  reason: FulfillmentPostingExclusionReason
  /** The number or value that proves the reason: the cutoff month, the currency, the gateways. */
  detail: string
}

/** What the dialog renders and what the run executes. */
export interface FulfillmentPostingPlan {
  grouping: FulfillmentPostingGrouping
  groups: FulfillmentPostingGroup[]
  exclusions: FulfillmentPostingExclusion[]
  footer: {
    postings: number
    shipments: number
    orders: number
    excluded: number
    totalMinor: number
  }
}

/** The run's input. The plan is recomputed server-side, never client-supplied. */
export interface FulfillmentPostingRequest {
  organizationId: string
  /** Null for the `auto` lane. */
  actorUserId: string | null
  /** Half-open on `shippedAt`: `from <= shippedAt < to`, both `YYYY-MM-DD`. */
  range: { from: string; to: string }
  grouping: FulfillmentPostingGrouping
  memo?: string
}

export interface FulfillmentPostingRunSummary {
  /** Groups that now carry a live posting. */
  posted: Array<{ groupKey: string; postingId: string; docNumber: string; shipments: number }>
  /** Groups the poster declined without error: `already_posted`, `disabled`, `locked` and the like. */
  skipped: Array<{ groupKey: string; status: string; reason: string }>
  /** Groups that wrote nothing because something threw. Never re-thrown. */
  failed: Array<{ groupKey: string; reason: string }>
  exclusions: FulfillmentPostingExclusion[]
}

/** A posting an order's shipment log names, for the order's ledger card. */
export interface OrderFulfillmentPostingRef {
  sequence: number
  shippedAt: string
  glPostingId: string
  docNumber: string | null
  /** The posting's status when read, so a reversed stamp renders as such. */
  status: 'posted' | 'reversed'
}

/** The `sourceType` the summarised lines of a batch entry carry; `sourceId` is the period key. */
export const FULFILLMENT_BATCH_SOURCE_TYPE = 'fulfillment_batch'

/** `accounting.fulfillmentPosting` (49 §2.4). */
export type FulfillmentPostingMode = 'manual' | 'auto'
export const FULFILLMENT_POSTING_MODES: readonly FulfillmentPostingMode[] = ['manual', 'auto']
export const FULFILLMENT_POSTING_SETTING_KEY = 'accounting.fulfillmentPosting'
