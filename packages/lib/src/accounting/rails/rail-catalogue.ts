// packages/lib/src/accounting/rails/rail-catalogue.ts

/**
 * What to SUGGEST when somebody routes a gateway handle for the first time
 * (`plans/accounting/tasks/26-a-clearing-account-per-rail.md` §7.2).
 *
 * From a handle this proposes a rail name, a settlement source, a fee
 * treatment and two account names. Every one of them is a default a person
 * then edits.
 *
 * ## 🛑 Suggestions, never routing
 *
 * Nothing here decides where money lands. A movement names its rail and
 * `resolveCashEndpoint` (`accounting/money/cash-endpoint.ts`) resolves that
 * rail's clearing account through the role assignment, never this table. A
 * catalogue that started answering "which account" would be a second resolver,
 * and two resolvers that disagree put a sale and its refund in different
 * accounts - which balances, and is therefore undetectable downstream.
 *
 * 🛑 **An unknown handle is never refused.** Same argument the Shopify
 * connector already makes for shipping `paymentGateways` with no predefined
 * options: a fixed list rejects the handles nobody has seen yet, and those are
 * exactly the ones worth discovering. {@link suggestRail} is TOTAL - an
 * unrecognised handle gets a titled name and the safe defaults, and `known`
 * says which happened so a screen can offer a free-text field rather than
 * pretending it recognised something.
 *
 * Client-safe: pure data and pure string arithmetic, no database, no io. Import
 * it as `@auxx/lib/accounting/rails/rail-catalogue`, never through the
 * `payment-gateways` barrel, which reaches Drizzle and the org cache.
 */

import {
  normaliseGatewayHandle,
  type PaymentGatewayFeeTreatmentValue,
  type PaymentGatewaySettlementSourceValue,
} from './client'

/**
 * How a rail charges for itself (brief 26 §4).
 *
 * - `netted`: the processor withholds its cut from the deposit, so the fee is
 *   known per settlement and its leg belongs inside the payout entry.
 * - `billed`: the deposit is GROSS and the fees arrive weeks later on a
 *   statement, so a payout entry with a fee leg on this rail is wrong.
 *
 * An alias of the stored vocabulary rather than a second literal union, so a
 * suggestion can never propose a treatment the record cannot hold.
 */
export type RailFeeTreatment = PaymentGatewayFeeTreatmentValue

/** What a handle suggests. Every field is a default a person may overwrite. */
export interface RailSuggestion {
  /** The rail's display name: `'Shopify Payments'`. */
  name: string
  /** How this rail drains, as far as auxx can read it. */
  settlementSource: PaymentGatewaySettlementSourceValue
  /** Whether the processor nets its fee out of the deposit or bills for it later. */
  feeTreatment: RailFeeTreatment
  /** A name for the asset clearing account: `'Shopify Payments Clearing'`. */
  clearingAccountName: string
  /** A name for the merchant fee account: `'Shopify Payments Fees'`. */
  feeAccountName: string
  /**
   * The handle matched an entry in the table below.
   *
   * `false` is the ORDINARY case, not an error: it means "auxx has not seen
   * this rail before", which is the discovery the census exists to make. A
   * screen should show the suggested name in an editable field either way, and
   * may say nothing at all about this flag.
   */
  known: boolean
}

/** One entry in the table, before the account names are derived from the name. */
interface RailEntry {
  name: string
  settlementSource: PaymentGatewaySettlementSourceValue
  feeTreatment: RailFeeTreatment
}

/**
 * Handle -> rail, keyed by NORMALISED handle ({@link normaliseGatewayHandle}),
 * so `'Affirm'`, `' affirm '` and `'AFFIRM'` are one entry.
 *
 * Several handles deliberately map to ONE name. §2 settles the grain: a
 * clearing account earns its keep by reconciling to zero against one external
 * document, so Shopify Payments and Shop Pay Installments - which arrive in the
 * same Shopify deposit - suggest the same rail and therefore the same account.
 * Splitting them makes the deposit unsplittable. The record already holds a SET
 * of handles and one account, which is exactly this shape.
 *
 * ⚠️ `settlementSource` here is what auxx can actually READ, not who owns the
 * rail. `stripe`, `shopify_payments` and `affirm` are the three rails a reader
 * is being built for; `afterpay`, `klarna`, `paypal`, `braintree`, `amazon_pay`,
 * `square` and the acquirer behind Authorize.Net all still suggest `manual` even
 * though every one of those processors plainly has an API - a settlement source
 * that promises a drain nobody wrote is worse than one that says "by hand".
 * A rail is promoted out of `manual` HERE only when its feed is being read, not
 * when somebody notices the vendor has documentation.
 *
 * ⚠️ `feeTreatment` is a SEPARATE question from `settlementSource` and does not
 * follow from it (§4). The clearest proof is two rails that share a settlement
 * source and disagree on fees: PayPal is `manual` and nets its cut out of the
 * deposit, while the traditional acquirer behind Authorize.Net is `manual`,
 * batches daily GROSS and bills monthly. Affirm makes the same point from the
 * other side - it now has a reader AND nets its discount fee. Two questions,
 * two fields.
 */
const RAILS: Record<string, RailEntry> = {
  stripe: { name: 'Stripe', settlementSource: 'stripe', feeTreatment: 'netted' },

  // One rail, three handles: Shopify's own deposit carries all of it (§2).
  shopify_payments: {
    name: 'Shopify Payments',
    settlementSource: 'shopify_payments',
    feeTreatment: 'netted',
  },
  shop_pay_installments: {
    name: 'Shopify Payments',
    settlementSource: 'shopify_payments',
    feeTreatment: 'netted',
  },
  shop_cash: {
    name: 'Shopify Payments',
    settlementSource: 'shopify_payments',
    feeTreatment: 'netted',
  },

  // Authorize.Net is a gateway in front of an acquirer, and the ACQUIRER is
  // what settles: a daily batch to the bank, gross, with the card fees billed
  // on a monthly statement. Three spellings are in the wild (§1.5's census
  // found two of them on one org).
  authorize_net: { name: 'Authorize.Net', settlementSource: 'manual', feeTreatment: 'billed' },
  'authorize.net': { name: 'Authorize.Net', settlementSource: 'manual', feeTreatment: 'billed' },
  authorizenet: { name: 'Authorize.Net', settlementSource: 'manual', feeTreatment: 'billed' },

  // ✔ Affirm settles to the bank on its own weekly `deposit_id`, and none of it
  // rides inside a Shopify Payments deposit (`plans/apps/affirm/portal-probe-2026-09-15.md`
  // §5: 31 Affirm-paid orders, 0 Shopify Payments balance entries). So it is a
  // genuine second rail with a feed of its own, not the `manual` case.
  // `netted` is confirmed by the same evidence and is unchanged: `fees`,
  // `txn_fees` and `mdr_rate` ride on the settlement event itself, which is what
  // netting means.
  // 🛑 One key, lower-cased. Shopify reports the handle as `'Affirm'`, but the
  // table is read through `normaliseGatewayHandle` - a second `'Affirm'` key
  // would be dead code.
  affirm: { name: 'Affirm', settlementSource: 'affirm', feeTreatment: 'netted' },
  afterpay: { name: 'Afterpay', settlementSource: 'manual', feeTreatment: 'netted' },
  klarna: { name: 'Klarna', settlementSource: 'manual', feeTreatment: 'netted' },
  paypal: { name: 'PayPal', settlementSource: 'manual', feeTreatment: 'netted' },
  braintree: { name: 'Braintree', settlementSource: 'manual', feeTreatment: 'netted' },
  amazon_pay: { name: 'Amazon Pay', settlementSource: 'manual', feeTreatment: 'netted' },
  square: { name: 'Square', settlementSource: 'manual', feeTreatment: 'netted' },
}

/**
 * The defaults an unrecognised handle gets.
 *
 * `manual` because auxx has no reader for a rail it has never heard of, and
 * `netted` because it preserves today's behaviour on every existing record -
 * `buildPayoutEntry` has only ever modelled the netted case (§4).
 */
const UNKNOWN_RAIL: Omit<RailEntry, 'name'> = {
  settlementSource: 'manual',
  feeTreatment: 'netted',
}

/**
 * What to put in the fields when somebody routes `handle` for the first time.
 *
 * TOTAL: every handle gets an answer, including the empty string. Nothing here
 * refuses, and nothing here routes - see this file's header.
 */
export function suggestRail(handle: string): RailSuggestion {
  const known = RAILS[normaliseGatewayHandle(handle)]
  const entry = known ?? { name: titleiseHandle(handle), ...UNKNOWN_RAIL }

  return {
    name: entry.name,
    settlementSource: entry.settlementSource,
    feeTreatment: entry.feeTreatment,
    clearingAccountName: `${entry.name} Clearing`,
    feeAccountName: `${entry.name} Fees`,
    known: known !== undefined,
  }
}

/**
 * `'shop_cash'` -> `'Shop Cash'`, `'my-gateway.v2'` -> `'My Gateway V2'`.
 *
 * A guess at what the merchant would have typed, offered in an editable field.
 * A handle that titles to nothing at all (blank, or punctuation alone) falls
 * back to a generic name rather than leaving the field empty, because the
 * account this names has to be called something and an empty name is the one
 * thing `createChartAccount` refuses.
 */
function titleiseHandle(handle: string): string {
  const words = handle
    .split(/[\s._-]+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())

  return words.length > 0 ? words.join(' ') : 'Payment Gateway'
}
