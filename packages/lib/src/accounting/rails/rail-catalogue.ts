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

import { PROCESSORS } from '../processors/client'
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
 * The rails auxx names but cannot read, keyed by NORMALISED handle
 * ({@link normaliseGatewayHandle}).
 *
 * ⚠️ `settlementSource` means what auxx can actually READ, not who owns the
 * rail. Every one of these processors plainly has an API, and every one still
 * suggests `manual`: a settlement source that promises a drain nobody wrote is
 * worse than one that says "by hand". A rail is promoted out of `manual` only
 * when its feed is being read, which means a folder under `accounting/processors/`.
 */
const MANUAL_RAILS: Record<string, RailEntry> = {
  afterpay: { name: 'Afterpay', settlementSource: 'manual', feeTreatment: 'netted' },
  klarna: { name: 'Klarna', settlementSource: 'manual', feeTreatment: 'netted' },
  paypal: { name: 'PayPal', settlementSource: 'manual', feeTreatment: 'netted' },
  braintree: { name: 'Braintree', settlementSource: 'manual', feeTreatment: 'netted' },
  amazon_pay: { name: 'Amazon Pay', settlementSource: 'manual', feeTreatment: 'netted' },
  square: { name: 'Square', settlementSource: 'manual', feeTreatment: 'netted' },
}

/** The handles {@link MANUAL_RAILS} claims; no processor may claim one too. */
export const MANUAL_RAIL_HANDLES: readonly string[] = Object.keys(MANUAL_RAILS)

/**
 * Handle -> rail. The readable rails come from the processor descriptors, so
 * several handles deliberately map to ONE name: a clearing account reconciles
 * to zero against one external document, and the record already holds a SET of
 * handles and one account (§2).
 *
 * ⚠️ `feeTreatment` does not follow from `settlementSource` (§4): Affirm and
 * Authorize.Net both read a feed, and one nets while the other is billed.
 */
const RAILS: Record<string, RailEntry> = {
  ...Object.fromEntries(
    PROCESSORS.flatMap((processor) =>
      processor.handles.map((handle) => [
        handle,
        {
          name: processor.railName,
          settlementSource: processor.id,
          feeTreatment: processor.feeTreatment,
        },
      ])
    )
  ),
  ...MANUAL_RAILS,
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
