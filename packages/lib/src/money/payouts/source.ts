// packages/lib/src/money/payouts/source.ts

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
 * 1. **Recognition is keyed on `ref.kind`, never on a charge id.** A Stripe
 *    item says `stripe_charge`, a Shopify item says `order`, a processor fee
 *    says `none`. `recognise.ts` answers each kind with its own lookup and
 *    `splitPayout` (`client.ts`) is otherwise unchanged.
 * 2. **A source with no items posts recognition equal to gross.** `totals`
 *    fills the split, the unrecognised remainder is zero by construction, and
 *    the record says `source: imported` so the screen can say "no itemisation"
 *    rather than "everything recognised".
 * 3. **`depositedMinor` is transcribed** from the header, never summed from
 *    the items. Summing would silently correct the provider's arithmetic, and
 *    the cash leg must equal what the bank line shows.
 */

import type { Database } from '@auxx/database'
import type {
  PaymentGatewayRow,
  PaymentGatewaySettlementSourceValue,
} from '../../payment-gateways/client'

/**
 * Which feed a source reads. Maps 1:1 onto the `payment_gateway` record's
 * `settlementSource`, so the rail's own declaration of how it drains IS the
 * registry key: `stripe`, `shopify_payments`, and `csv` once unit 3 adds that
 * value to the settlement-source vocabulary. `manual` is the one value that can
 * never name a source - a billed rail is relieved in the review queue (§3) and
 * wants no feed, ever.
 *
 * ⚠️ **A key here is not a promise that a source exists.** `affirm` joined the
 * vocabulary with `plans/apps/affirm/affirm-build-plan.md` §5.1 and is therefore
 * in this union, but **nothing will ever register a `PayoutSource` for it, by
 * design** (that plan's §5.3, resolved 2026-09-15). Affirm is read by the
 * financial connector (task 46), and the two paths are MUTUALLY EXCLUSIVE:
 * {@link assertLegacyPayoutIngestionOwner} refuses this legacy writer once a
 * connector holds an enabled `upsert` mapping into `payout` or
 * `processor_balance_entry` for the same installation and credential. An
 * `AFFIRM_PAYOUT_SOURCE` would therefore throw on every run.
 *
 * Until something registers it, `getPayoutSource` answers a `NotFoundError`
 * naming the id and the sweep never polls it, which is a visible absence rather
 * than a silent one. For `affirm` that absence is the permanent, correct state.
 */
export type PayoutSourceId = Exclude<PaymentGatewaySettlementSourceValue, 'manual'>

/** `api` is polled by the sweep; `file` returns what it was handed and is never polled. */
export type PayoutSourceKind = 'api' | 'file'

/**
 * What auxx could recognise one settled item against.
 *
 * - `stripe_charge`: a `PaymentTransaction` row, by `stripeChargeId` or
 *   `stripeRefundId` (a refund is a negative item on its charge's side).
 * - `order`: the synced order, by the connector's own upstream id - for Shopify
 *   the numeric REST `Order.id`, which is `balance_transaction.source_order_id`
 *   and the connector's `externalId` in one keyspace (gap-a §1.2).
 * - `none`: nothing auxx could hold a record for - a processor's monthly fee,
 *   an adjustment, a transfer. Always unrecognised.
 */
export type PayoutItemRef =
  | { kind: 'stripe_charge'; id: string }
  | { kind: 'order'; id: string }
  | { kind: 'none' }

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
 * ## The rail is IN the context (§4, §6.2)
 *
 * That is what retired the per-payout `resolvePayoutGateway` call: the source
 * that built the context already knows which `payment_gateway` record it is
 * reading for, and every payout it lists is stamped with it and routed through
 * its clearing and fee accounts. `rail: null` is the role fallback - no record
 * claims the source's stream - which only the Stripe source can produce, and
 * which is bit for bit what every org did before brief 26.
 *
 * `conflictingRails` is the OTHER way a source can fail to name one rail:
 * several records claim its stream. `rail` is null and every payout is raised
 * and then BLOCKED naming them all (26 §13 decision 2), never guessed at.
 */
export interface PayoutSourceCtx {
  organizationId: string
  sourceId: PayoutSourceId
  rail: PaymentGatewayRow | null
  conflictingRails: readonly PaymentGatewayRow[]
  /**
   * What the source needs to reach its provider: a Stripe connected-account id,
   * an app tool handle, a parsed file. Opaque here; the source that built the
   * context is the one that reads it back, and it narrows.
   */
  handle: unknown
  /** Adapter-declared identity used to prevent another writer claiming the same feed. */
  ownership?: {
    sourceAccount?: {
      providerKey: string
      externalAccountId: string
      environment?: 'live' | 'test'
    }
    appInstallationId?: string
    credentialId?: string
  }
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
