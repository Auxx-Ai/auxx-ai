// packages/lib/src/accounting/money/payouts/source.ts

/**
 * The `PayoutSource` contract
 * (`plans/accounting/tasks/27-a-settlement-from-anywhere.md` §4): what any
 * rail's settlement feed has to hand the payout pipeline, so that `sync.ts`
 * raises the record, splits it and posts it without knowing which provider it
 * is reading.
 *
 * Client-safe: every import here is a TYPE import and is erased at build time,
 * so a browser bundle (unit 3's import preview builds {@link PayoutHeader}s)
 * can take this file without dragging Drizzle or the Stripe SDK along. Nothing
 * runs in this module. The registry that holds the implementations is
 * `source-registry.ts`; the implementations themselves live under `sources/`.
 *
 * ## The three rules the contract carries (§4)
 *
 * 1. **A feed the evidence lane observes is split off its stored match**
 *    (`gather.ts`), and this contract's items are the fallback for one that is
 *    not. `recognise.ts` answers `stripe_charge`; everything else is `none`.
 * 2. **A source with no items posts recognition equal to gross.** `totals`
 *    fills the split, the unrecognised remainder is zero by construction, and
 *    the record says `source: imported` so the screen can say "no itemisation"
 *    rather than "everything recognised".
 * 3. **`depositedMinor` is transcribed** from the header, never summed from
 *    the items. Summing would silently correct the provider's arithmetic, and
 *    the cash leg must equal what the bank line shows.
 */

import type { Database } from '@auxx/database'
import type { PaymentGatewayRow, PaymentGatewaySettlementSourceValue } from '../../rails/client'

/**
 * Which feed a source reads. Matches the `providerKey` a linked
 * `FinancialSourceAccount` carries (task 58 §5.5) - `stripe`,
 * `shopify_payments`, and `csv` once unit 3 adds that value. `manual` is the
 * one value that can never name a source - a billed rail is relieved in the
 * review queue (§3) and wants no feed, ever.
 *
 * ⚠️ **A key here is not a promise that a source exists.** `affirm` joined the
 * vocabulary with `plans/apps/affirm/affirm-build-plan.md` §5.1 and
 * `authorize_net` with `plans/apps/authorize-net/authorize-net-build-plan.md`
 * §5.1, so both are in this union - but **nothing will ever register a
 * `PayoutSource` for either, by design** (those plans' §5.3 and §5.4). Both are
 * read by the financial connector (task 46) instead, through their own evidence
 * path; an `AFFIRM_PAYOUT_SOURCE` would simply never be registered.
 *
 * Until something registers it, `getPayoutSource` answers a `NotFoundError`
 * naming the id and the sweep never polls it, which is a visible absence rather
 * than a silent one. For those two that absence is the permanent, correct state.
 */
export type PayoutSourceId = Exclude<PaymentGatewaySettlementSourceValue, 'manual'>

/** `api` is polled by the sweep; `file` returns what it was handed and is never polled. */
export type PayoutSourceKind = 'api' | 'file'

/**
 * What auxx could recognise one settled item against, on a feed with no
 * `ProcessorBalanceEntry` rows (`plans/accounting/payout-links.md` §11.3).
 *
 * - `stripe_charge`: a `MoneyTransaction`, through `FinancialSourceObject` →
 *   `MoneySourceLink` (a refund is a negative item on its charge's side).
 * - `none`: nothing auxx could hold a record for - a processor's monthly fee,
 *   an adjustment, a transfer. Always unrecognised.
 *
 * There is no `order` kind. Recognising a Shopify item by its `source_order_id`
 * said "the order is here", never "this $60 arrived", and the stored match says
 * the second (§6.1); a Shopify Payments payout is split off its evidence rows.
 */
export type PayoutItemRef = { kind: 'stripe_charge'; id: string } | { kind: 'none' }

/** One settled item inside a payout, reduced to what the split needs. */
export interface PayoutItem {
  /** The provider's own id for the item (a balance-transaction id). Messages and logs only. */
  externalId: string
  /** Gross, integer minor units. NEGATIVE for a refund or a dispute. */
  grossMinor: number
  /** What the processor withheld on it, integer minor units, positive. */
  feeMinor: number
  ref: PayoutItemRef
}

/** What a source says about one payout, before its items are read. */
export interface PayoutHeader {
  providerPayoutId: string
  /** `YYYY-MM-DD` in UTC: the date the money reached, or is due to reach, the bank. */
  paidAt: string
  /** Lowercase, as the provider reports it. */
  currency: string
  status: 'in_transit' | 'paid' | 'failed' | 'canceled'
  /** The WHOLE transfer that reached the bank, integer minor units. Transcribed, never summed. */
  depositedMinor: number
  /** Only when the source has totals and no items (a statement row). Rule 2 above. */
  totals?: { grossMinor: number; feesMinor: number }
  /** What the provider says about the destination, if anything. Stripe: `ba_…`. Shopify: nothing. */
  destinationHint?: string
}

/**
 * Everything one run of a source needs: the org, the rail it reads for, and
 * whatever reaches its provider.
 *
 * ## The rail is IN the context, always exactly one (task 58 §5.3, §5.5)
 *
 * A context is built per live `FinancialSourceAccount` a person has linked to
 * a `payment_gateway` record (`reads.ts`'s `listLinkedFeedAccounts`), never
 * filtered by the retired `settlementSource` enum - so `rail` is REQUIRED, not
 * a role fallback. A payout with no rail cannot exist: it was read by a source
 * that is linked to one. A feed nothing has linked yet builds no context at
 * all, and two feeds linked to two different rails are two contexts, not a
 * conflict - each posts its own payouts through its own rail.
 */
export interface PayoutSourceCtx {
  organizationId: string
  sourceId: PayoutSourceId
  rail: PaymentGatewayRow
  /**
   * What the source needs to reach its provider: a Stripe connected-account id,
   * an app tool handle, a parsed file. Opaque here; the source that built the
   * context is the one that reads it back, and it narrows.
   */
  handle: unknown
}

/**
 * One rail's settlement feed.
 *
 * The house provider shape (`postings/provider.ts`): an object with an `id`, a
 * registry keyed on it, and registration from the app boot rather than a
 * static import here, so lib never hardwires a source into the pipeline.
 *
 * `listOrganizations` and `resolveContexts` are how an `api` source tells the
 * sweep what to poll. They are the source's to answer because discovery is
 * provider-shaped: Stripe Connect knows its orgs from `PaymentAccount` and
 * must still be swept when NO gateway record claims it (the role fallback),
 * while Shopify Payments is one context per `shopify_payments` rail. A `file`
 * source implements neither - it is handed its context by an import.
 */
export interface PayoutSource {
  readonly id: PayoutSourceId
  readonly kind: PayoutSourceKind
  /** `api` only: every org holding something this source can poll. */
  listOrganizations?(db: Database): Promise<string[]>
  /**
   * `api` only: the contexts to poll for one org, from its `payment_gateway`
   * records (read once by the caller). Empty when nothing is connected.
   */
  resolveContexts?(
    db: Database,
    organizationId: string,
    rails: readonly PaymentGatewayRow[]
  ): Promise<PayoutSourceCtx[]>
  /** Payouts settled since `since`, OLDEST first. A file source returns what it was given. */
  listPayouts(ctx: PayoutSourceCtx, since: Date): Promise<PayoutHeader[]>
  /** The items inside one payout. Absent for a source that has totals only. */
  listItems?(ctx: PayoutSourceCtx, payout: PayoutHeader): Promise<PayoutItem[]>
}
