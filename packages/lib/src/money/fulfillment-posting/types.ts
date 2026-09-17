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
 * drains clearing; a terms order owes, and aging names the debtor; a cash
 * order waits, undeposited, for a bank run (task 58 §5.2 D12).
 *
 * 🛑 **`'gateway'` is gone (task 58).** Every non-card rail used to fall into
 * this bucket, debiting a `payment_gateway` record's OWN clearing account by
 * id. That account is now `clearing`, scoped to the record's id through
 * `sourceScope.rail` (`ShipmentAmounts.debitRail`) - one role, resolved per
 * rail, the same way a scoped `revenue_product` already resolved per store.
 */
export type FulfillmentDebitRole = 'clearing' | 'accounts_receivable' | 'undeposited_funds'

/**
 * What a shipment debits: a declared ROLE, `clearing` carrying the rail its
 * scope resolves through (task 58 §5.2).
 */
export type FulfillmentDebit =
  | { role: 'clearing'; rail: string | null; reason?: string }
  | { role: Exclude<FulfillmentDebitRole, 'clearing'>; reason?: string }

/**
 * Why the debit fork chose what it chose, as a predicate on the order(s) it
 * describes (brief 28 §5). Optional so a hand-built debit and every caller that
 * predates the field are unaffected; `resolveFulfillmentDebit` always sets it.
 *
 * Phrased to follow a subject: the builder prefixes `Order #2003 ` on a
 * per-order receivable line and `41 orders ` on a summarised one, so a sentence
 * reads *"41 orders paid through shopify_payments, which no gateway record
 * claims, so the card clearing fallback."*
 */
export type FulfillmentDebitReason = string

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
  fulfillmentLineId?: string
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
  /**
   * `line_item_line_total` for the WHOLE line, integer minor units, or null
   * when the line carries none. With `orderedQuantity` and
   * `priorShippedQuantity` the builder allocates the line total cumulatively
   * by units, so a fractional net rate (181 over 2) still sums to the line
   * across its shipments (29 §12 item 6). Absent falls back to extending
   * `unitPriceMinor`.
   */
  lineTotalMinor?: number | null
  /**
   * Units of this line shipped by EARLIER fulfillments of the order that
   * recognised revenue - the same live-or-posted rule
   * `priorShipmentsSubtotalMinor` follows. `0` on the first shipment.
   */
  priorShippedQuantity?: number
  name?: string
}

/** One source with no accepted original membership. Legacy stamps require explicit repair. */
export interface UnpostedShipment {
  /** Historical journals require explicit membership repair before another original can post. */
  legacyPostingId?: string | null
  orderId: string
  orderNumber: string
  /**
   * The `fulfillment` EntityInstance id `run.ts` stamps -
   * `stampFulfillmentPosting` (`money/fulfillments`) targets a record
   * directly, never a `(orderId, sequence)` composite key.
   */
  fulfillmentInstanceId: string
  /** `fulfillment_sequence`. 1-based within the order, ship-date order. */
  sequence: number
  /** `YYYY-MM-DD`, the fulfillment's `shippedAt` day. The recognition date. */
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
  /** `fulfillment_shipping_recognised`. Exactly one shipment per order carries it. */
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
  /** Shopify source provenance selected by the canonical money timeline. */
  sourceStoreId?: string | null
  /** Rail selected by the canonical receipt timeline; feeds `calculation.paymentGatewayId`. */
  /** Conserved tax components for this recognition event. */
  recognitionTaxComponents?: readonly FulfillmentRecognitionTaxComponent[]
  /**
   * Numeric ownership calculated by the canonical receipt and shipment
   * timeline. When present, this shipment is on the switched customer-money
   * policy and must never fall back to the legacy gateway fork.
   */
  recognitionAllocation?: FulfillmentRecognitionAllocation
}

/** One conserved tax component share for a recognition event. */
export interface FulfillmentRecognitionTaxComponent {
  componentKey: string
  amountMinor: number
  jurisdiction: string | null
  collector: 'merchant' | 'marketplace'
  remitter: 'merchant' | 'marketplace'
  withholdingEvidenceId: string | null
}

/** One shipment's frozen deposit, receivable and newly recognized tax split. */
export interface FulfillmentRecognitionAllocation {
  /** Helper event amount, including pretax shipment revenue and new tax. */
  amountMinor: number
  depositMinor: number
  receivableMinor: number
  taxMinor: number
  historyHash: string
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
   * The `payment_gateway` record id `debitRole: 'clearing'` scopes through
   * (`sourceScope.rail`, task 58 §5.2) - a matched record's id, or `null` when
   * none claimed the handle (resolves to the org default). Absent for the two
   * unscoped roles.
   */
  debitRail?: string | null
  /**
   * The fork's reason for `debitRole` / `debitRail`, carried from
   * `resolveFulfillmentDebit` through `computeShipmentAmounts` so the batch
   * builder can write it onto the debit line per account, with an order count
   * (brief 28 §5). Absent when the caller passed a bare role.
   */
  debitReason?: FulfillmentDebitReason
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
  /** Debit released from customer deposits under the switched policy. */
  depositDebitMinor?: number
  /** Debit raised to accounts receivable under the switched policy. */
  receivableDebitMinor?: number
  /** Tax credit newly recognized by this shipment under the switched policy. */
  newlyRecognizedTaxMinor?: number
  /** Source shipment tax, retained separately from the journal tax credit. */
  sourceTaxMinor?: number
  /** Cumulative recognition history used to freeze the numeric allocation. */
  recognitionHistoryHash?: string
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

/**
 * `accounting.fulfillmentGrouping` (accounting brief 28 §3.1): the grouping the
 * posting dialog opens on. A default, not a rule - the dialog may change it for
 * one run, and the `auto` lane posts per day regardless (see
 * `jobs/money/fulfillment-posting-job.ts`).
 */
export const FULFILLMENT_GROUPING_SETTING_KEY = 'accounting.fulfillmentGrouping'
