// packages/lib/src/postings/default-chart.ts
//
// The default chart of accounts auxx.ai seeds into an organization.
//
// PURE DATA. No database, no io - `postings/` already owns the account
// vocabulary (`ACCOUNT_ROLES` in build-entry.ts), the period keyspace and the
// provider seam, so the chart that vocabulary maps onto belongs here rather
// than in `seed/`. The entity migration that writes these rows imports this
// constant; `seed -> lib` is the sanctioned direction and `lib -> seed` is not.

import { GlAccountType } from '../resources/registry/enum-values'
import type { AccountRole } from './build-entry'

/**
 * The five statement classifications, as a literal union.
 *
 * Derived from `GlAccountType`'s named members rather than from its `values`
 * array: `satisfies FieldOptionItem[]` widens `value` to `string`, so
 * `values[number]['value']` would let `accountType: 'nonsense'` compile - a
 * chart is data, and data that typechecks against `string` is unchecked.
 */
export type GlAccountTypeValue = (typeof GlAccountType)[Exclude<
  keyof typeof GlAccountType,
  'values'
>]

/** One account in the seeded default chart. */
export interface DefaultChartAccount {
  /** The account number. Unique per org, and the org may change it. */
  code: string
  name: string
  /** One of the five statement classifications (`GlAccountType`). */
  accountType: GlAccountTypeValue
  /**
   * The auxx posting role this account fulfils, if any.
   *
   * Absent for most accounts, and that is the ordinary case - the majority of a
   * chart is the org's own bookkeeping and auxx posts to none of it.
   */
  role?: AccountRole
}

/**
 * The default chart of accounts, seeded into every organization.
 *
 * ## What this is, and what it is NOT
 *
 * **It is a DEFAULT, not a standard** (decision `G7`). Charts of accounts are
 * not standardised: US GAAP mandates no numbering at all, QuickBooks' own
 * default chart varies by country and by industry and is routinely edited on
 * day one, and some jurisdictions mandate an entirely different one - France's
 * PCG, Germany's SKR03/04. So auxx seeds this, and a person changes it: renames
 * an account, renumbers one, deactivates one at year end, adds twenty of their
 * own.
 *
 * **That editability is exactly why nothing in the code may name a number.**
 * The `role` column is the load-bearing part of every row here (decision `G8`).
 * A builder emits `ACCOUNT_ROLES.GRNI`; the resolver reads THIS org's chart to
 * learn that GRNI is `2160` here and `2155` at the customer who renumbered it.
 * Change a `code` below and posting still works. Change a `role` and it stops -
 * which is why the role field is where the care goes.
 *
 * **It is not a complete chart.** The source (`plans/money/accrual-accounting-plan.html`
 * §2) is titled *"Accounts to add in QuickBooks"* - it presumes an existing
 * book with bank accounts, equity, retained earnings, operating expenses and the
 * rest already in place. Five accounts the posting builders need are added on
 * top of it (`1000`, `2000`, `2160`, `2170`, `5095`), because the accrual plan's
 * table does not list them. There are no equity accounts here at all, deliberately:
 * nothing auxx posts touches equity, and inventing an owner's-equity numbering
 * for someone else's book would be a guess with no purpose.
 *
 * ## The two things to check before this is seeded
 *
 * 1. **The numbering.** It is the accrual plan's, which was written against one
 *    company's QuickBooks. A new org gets it as a starting point.
 * 2. **The type mapping.** The accrual plan's *Type* column carries QuickBooks
 *    DETAIL types (`Other Current Asset`, `Cost of Goods Sold`, `Income`,
 *    `Accounts Receivable`, `contra-asset`). `GlAccountType` is the five-way
 *    statement classification, so they are collapsed: Income -> `revenue`, Cost
 *    of Goods Sold and Expense -> `expense`, every asset flavour -> `asset`,
 *    Other Current Liability -> `liability`. Nothing here is `equity`. The
 *    collapse loses the current/non-current split and the contra-asset marking
 *    on `1190`; that is a presentation concern for the provider's own chart,
 *    not something a posting reads.
 *
 * @see ACCOUNT_ROLES in `build-entry.ts` for what each role means
 * @see plans/money/accrual-accounting-plan.html §2 for the accounting argument
 */
export const DEFAULT_CHART_OF_ACCOUNTS: readonly DefaultChartAccount[] = [
  // ── Assets ──────────────────────────────────────────────────────────────
  {
    // Not in the accrual plan's table - added because `buildBillPaymentEntry`
    // credits it in ledger mode (decision P12). An org that already has a bank
    // account should repoint this role at it rather than keep a second one.
    code: '1000',
    name: 'Cash',
    accountType: GlAccountType.ASSET,
    role: 'cash',
  },
  {
    code: '1100',
    name: 'Accounts Receivable - Dealers',
    accountType: GlAccountType.ASSET,
    // No role: nothing auxx posts today touches receivables. The fulfillment
    // builder will, and that is when a role gets added - not before.
  },
  {
    code: '1190',
    name: 'Allowance for Doubtful Accounts',
    // A contra-asset. `GlAccountType` has no contra classification and does not
    // need one - it is a presentation attribute, not a posting rule.
    accountType: GlAccountType.ASSET,
  },
  {
    code: '1200',
    name: 'Shopify Clearing',
    accountType: GlAccountType.ASSET,
  },
  {
    // Must EXCLUDE every Affirm-gateway order or 1200 can never reconcile to
    // zero: Shopify never touches Affirm money, so those settlements are
    // invisible to the payouts API (accrual plan §3).
    code: '1210',
    name: 'Affirm Clearing',
    accountType: GlAccountType.ASSET,
  },
  {
    code: '1310',
    name: 'Raw Materials / Parts',
    accountType: GlAccountType.ASSET,
    role: 'inventory_raw_materials',
  },
  {
    // Receipts never touch this - nothing in the `partKind` table maps to WIP.
    // It is here because the L1 month-end inventory entry moves all THREE
    // inventory accounts to the balance the subledger computes (04-books §2.1),
    // and that entry is the January 1 deliverable.
    code: '1320',
    name: 'Work in Process',
    accountType: GlAccountType.ASSET,
    role: 'inventory_wip',
  },
  {
    code: '1330',
    name: 'Finished Goods',
    accountType: GlAccountType.ASSET,
    role: 'inventory_finished_goods',
  },

  // ── Liabilities ─────────────────────────────────────────────────────────
  {
    // Not in the accrual plan's table - added because the vendor bill builder
    // credits it. 🛑 The A/P leg cannot post until one `Bill` object has
    // existed in QuickBooks; the provider's A/P account is not addressable
    // before that (04-books §3). An ordering constraint on the cutover.
    code: '2000',
    name: 'Accounts Payable',
    accountType: GlAccountType.LIABILITY,
    role: 'accounts_payable',
  },
  {
    code: '2100',
    name: 'Accrued Payroll',
    accountType: GlAccountType.LIABILITY,
    // Straddling pay periods. Distinct from 2110 - this one is an accrual, that
    // one is a clearing pool. Not a role: no builder writes it.
  },
  {
    code: '2110',
    name: 'Payroll Clearing (ADP)',
    accountType: GlAccountType.LIABILITY,
    role: 'payroll_clearing',
  },
  {
    // BROADER than "carrier freight", deliberately (`G17`). A customs broker's
    // service charge is attributable to a shipment, so it is landed cost and it
    // clears here — NOT through 2170, which is duty owed to the government. The
    // internal role stays `freight_accrual`: `G17` explicitly permits the name
    // and the role to differ, and renaming a role is a vocabulary migration
    // across the ledger for no behavioural gain.
    code: '2150',
    name: 'Inbound Freight & Brokerage Accrual',
    accountType: GlAccountType.LIABILITY,
    role: 'freight_accrual',
  },
  {
    // Not in the accrual plan's table. The single most load-bearing account in
    // the purchasing subledger: credited on receipt at the VENDOR unit price,
    // debited when the vendor's bill arrives.
    code: '2160',
    name: 'Goods Received Not Invoiced',
    accountType: GlAccountType.LIABILITY,
    role: 'grni',
  },
  {
    // Not in the accrual plan's table. Tariffs and customs duties owed
    // SEPARATELY TO THE U.S. GOVERNMENT.
    //
    // 🛑 NOT the customs broker's share. This file, `build-entry.ts` and the
    // (now deleted) registry enum all used to say it held "the customs broker's
    // share"; all three were wrong. A broker sells a service on a shipment, so
    // their charge is inbound freight's problem and clears through 2150.
    //
    // Only ever carries a balance when a receipt had a non-zero tariff portion;
    // build plan phase 0.1 asks whether `tariffRate` is ever non-zero at all. An
    // org that never imports can deactivate it and no posting will ever
    // reference it.
    code: '2170',
    name: 'Duties Accrual',
    accountType: GlAccountType.LIABILITY,
    role: 'duties_accrual',
  },
  {
    // Sales tax is NEVER revenue and never an expense - a pass-through
    // liability from the moment Shopify collects it (accrual plan §1).
    code: '2200',
    name: 'Sales Tax Payable',
    accountType: GlAccountType.LIABILITY,
  },
  {
    code: '2300',
    name: 'Deferred Revenue',
    accountType: GlAccountType.LIABILITY,
    // Month-end only, reversed on day one of the next month. The
    // `month_end_deferral` / `month_end_reversal` builders will want a role
    // here; they do not exist yet.
  },
  {
    code: '2350',
    name: 'Customer Deposits',
    accountType: GlAccountType.LIABILITY,
  },
  {
    code: '2400',
    name: 'Returns Reserve',
    accountType: GlAccountType.LIABILITY,
  },

  // ── Revenue ─────────────────────────────────────────────────────────────
  {
    // 4000 and 4010 stay SEPARATE from day one. Blended into one account, a
    // shift in channel mix looks like a margin problem with no visible cause
    // (accrual plan §3).
    code: '4000',
    name: 'Product Revenue - DTC',
    accountType: GlAccountType.REVENUE,
  },
  {
    code: '4010',
    name: 'Product Revenue - Dealer',
    accountType: GlAccountType.REVENUE,
  },

  // ── Cost of goods sold ──────────────────────────────────────────────────
  // `GlAccountType` has no COGS classification; all five map to `expense`.
  {
    // 🛑 A coding requirement, not a habit: parts purchases must land HERE off
    // the bank feed (or in a Purchases account that closes to it), so the L1
    // month-end entry has the right account to offset (04-books §2.1).
    code: '5000',
    name: 'COGS - Product Cost',
    accountType: GlAccountType.EXPENSE,
    role: 'cogs_product_cost',
  },
  {
    code: '5010',
    name: 'COGS - Direct Labor',
    accountType: GlAccountType.EXPENSE,
    // No role, and it stays empty under L1. The labour that went into inventory
    // is relieved from 2110 Payroll Clearing by the month-end entry, and the
    // labour that then LEFT inventory on a shipment lands in 5000's plug - a
    // movement freezes one total unit cost, so nothing can say how much of a
    // shipped unit's cost was labour. That is why 5000 is named for product
    // cost rather than materials. See `COGS_PRODUCT_COST` in build-entry.ts.
  },
  {
    code: '5020',
    name: 'COGS - Applied Overhead',
    accountType: GlAccountType.EXPENSE,
    role: 'applied_overhead',
  },
  {
    code: '5030',
    name: 'COGS - Freight-Out',
    accountType: GlAccountType.EXPENSE,
    // Above gross profit, deliberately (accrual plan §4). Distinct from the
    // `freight_accrual` LIABILITY, which is inbound freight capitalised into
    // landed cost. Two different freights; do not point one role at both.
  },
  {
    code: '5090',
    name: 'Inventory / Purchase Price Variance',
    accountType: GlAccountType.EXPENSE,
    role: 'ppv',
  },
  {
    // 🛑 A SIBLING of 5090, not a merge with it (`G12`). 5090 answers "the
    // vendor billed something other than what we accrued"; this one answers
    // "the shelf disagrees with the ledger". Different owner, different remedy,
    // different trend — one account holding both answers neither, and the L1
    // month-end assertion would absorb count variance into the COGS plug, which
    // is precisely the separation `G12` exists to get.
    //
    // Numbered 5095 so the two read as a pair in a sorted chart.
    code: '5095',
    name: 'Inventory Count Variance',
    accountType: GlAccountType.EXPENSE,
    role: 'inventory_count_variance',
  },

  // ── Operating expenses ──────────────────────────────────────────────────
  {
    code: '6100',
    name: 'Merchant Fees - Cards',
    accountType: GlAccountType.EXPENSE,
  },
  {
    // Kept separate from 6100 for RECONCILIATION, not optimisation: Affirm
    // settles in its own deposit, so its fees have to be separable to clear
    // 1210 (accrual plan §3).
    code: '6105',
    name: 'Merchant Fees - Affirm',
    accountType: GlAccountType.EXPENSE,
  },
  {
    // Pick/pack/receive labour - explicitly NOT inventory (accrual plan §2).
    code: '6200',
    name: 'Fulfillment Labor',
    accountType: GlAccountType.EXPENSE,
  },
]
