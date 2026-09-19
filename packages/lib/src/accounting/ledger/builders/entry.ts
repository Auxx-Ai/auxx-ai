// packages/lib/src/accounting/ledger/builders/entry.ts
//
// PURE. Turns source rows into balanced posting lines. No database, no provider,
// no clock, no io. Everything here is a total function of its arguments, which
// is what lets the balance rule below be tested exhaustively instead of hoped
// for.
//
// Failures here are programmer error - an unbalanced entry means the caller
// computed the wrong numbers - so this file THROWS `AuxxError` subclasses rather
// than returning a `Result`. Per docs/lib-module-guide.md, `Result` is for
// runtime failure; a builder that cannot balance its own arithmetic is a bug.

import { isAtPrecision } from '@auxx/utils/currency'
import { UnprocessableEntityError } from '../../../errors'
// Plain data, no io - the same direction `account-subtype.ts` already takes.
import { GlAccountSubtype } from '../../../resources/registry/enum-values'
// Pure arithmetic, no io - 73 §5.2 keeps the spread in one place rather than
// copying it here. `purchasing/` becomes a sibling of this module in 73 U9.
import { allocateCapitalisedCost } from '../../purchasing/allocate-landed-cost'
import type { AllocationBasis, AllocationLine } from '../../purchasing/types'
import type { GlAccountSubtypeValue } from '../chart/account-subtype'
// Type-only, so this file stays pure: `default-chart.ts` imports the statement
// classifications from the registry at runtime, and nothing of that reaches here.
import type { GlAccountTypeValue } from '../chart/default-chart'
import { assertCompactablePeriodKey } from '../periods/period-key'
import type { BuiltEntry, CounterpartyType, GlPostingLineInput, PostingType } from '../types'
// A cycle with `fulfillment.ts`, which imports this module: safe because every
// use on both sides is inside a function body, never at module scope.
import { toAmountMinor } from './fulfillment'

/**
 * The posting ROLES this module emits, in one place.
 *
 * ## Why this is not a list of account numbers
 *
 * It used to be. `GRNI: '2160'` was a code, and a code is what a posting line
 * carries all the way to the provider (decision `P2`): a code is ours, it means
 * the same thing whether QuickBooks is connected, replaced or absent, and it is
 * what makes an entry auditable three years later with no API call.
 *
 * `P2` is unchanged. What changed is one layer above it. Decision `G7` makes
 * the chart of accounts a seeded **default the org edits**, not a fixed list -
 * charts are not standardised, US GAAP mandates no numbering, QuickBooks'
 * default varies by country and industry and is routinely edited, and France's
 * PCG and Germany's SKR03/04 mandate different ones outright. The moment the
 * chart is editable, the NUMBER can no longer carry the meaning: a customer who
 * renumbers goods-received-not-invoiced from `2160` to `2155` would silently
 * break every posting that hardcoded `'2160'`. The entry would still balance,
 * so nothing downstream could detect it. It would surface at a close, as a
 * number that is wrong for reasons nobody can reconstruct.
 *
 * So decision `G8`: **a builder posts to a role, and the org maps one of its own
 * accounts to that role.** The chain is
 *
 * ```
 *   role  ->  the org's gl_account  ->  its code  ->  the provider's own id
 *          ^                         ^                ^
 *          |                         |                `AccountingProvider.resolveAccount`
 *          |                         the ledger line stores this (P2)
 *          the resolver, ahead of the claim - fails CLOSED on 0 or >1 match
 * ```
 *
 * Only the last hop belongs to a provider adapter, exactly as before. `G8` adds
 * the FIRST hop, and it is what keeps `G7` and correctness both true. It is
 * `P2`'s own argument one level up: `P2` refuses to tie the ledger to one
 * provider's account ids, `G8` refuses to tie it to one company's numbering.
 *
 * ## Why named constants rather than string literals
 *
 * Unchanged from when these were codes: `'grni'` appearing in four builders is
 * four places to get it wrong, and a posting to the wrong account balances
 * perfectly and is invisible until a close.
 *
 * ## This vocabulary is auxx's, and it is CLOSED
 *
 * An org may renumber, rename or replace the account behind a role. It may not
 * invent a role, because a role only means something if a builder emits it.
 *
 * ✅ **This is the ONLY copy of the role vocabulary.** It used to have a twin -
 * a `GlAccountRole` registry enum that existed purely to supply the options of
 * a `gl_account.role` SINGLE_SELECT field. Decision `G19` replaced that field
 * with the `GlRoleAssignment` table, whose `role` column is deliberately plain
 * `text` rather than a `pgEnum` for exactly this reason, so the second copy went
 * with it. Adding a role is now a one-line edit here plus a row in
 * {@link ROLE_ACCOUNT_TYPES} and a label in {@link ACCOUNT_ROLE_LABELS} - both
 * pinned to this constant by `__tests__/build-entry.test.ts`. There is no
 * options migration, because there are no options.
 *
 * ## Scope: a role exists only if a builder emits it
 *
 * That is the admission test, and it is the reason three roles were deleted on
 * 2026-09-10 rather than left to sit on the checklist:
 *
 * | Deleted | Why |
 * | --- | --- |
 * | `deferred_revenue` | no builder, not even an unwired one. `2300` stays in the `prepayments` pack as a plain account. |
 * | `equity_opening_balance` | `buildOpeningBalanceEntry` takes the account ids a person typed into the grid, so it emits no role at all. `3900` stays in the chart. |
 * | `clearing_affirm` | a role must not name a vendor - see the two rules below. Affirm is a `payment_gateway` record now, and `1210` left the `card_rail` pack with it. |
 *
 * Four roles are declared with no reachable emitter, and they stay: `grni`,
 * `freight_accrual` and `duties_accrual` are emitted by the bills that clear them,
 * `ppv` by {@link buildVendorBillEntry}. Both builders are written and tested;
 * neither has a caller yet, because receiving does not post under L1 (see
 * `regime.ts`). Deleting the roles would mean deleting the builders.
 *
 * 🛑 An unmapped role costs nothing until a builder emits it - `resolveRoles`
 * fails closed and names it. So the argument for deleting one is never
 * correctness; it is that every declared role is a row on a bookkeeper's
 * checklist, and a row nothing can ever post to is a question with no answer.
 */
/*
 * Two rules about what a role is NOT (brief 13 §2 and §5, 2026-09-10) — qualified by a
 * rail scope, brief 58 §2.4, 2026-09-16:
 *
 * - **A bank account is not a role — for an ORG-WIDE map.** `cash` was retired because
 *   "which bank" has no org-wide answer. Once the map gained a rail scope, {@link
 *   ACCOUNT_ROLES.BANK} IS a role, admissible precisely because it can never resolve
 *   org-wide ({@link ROLES_WITHOUT_DEFAULT}): it only ever answers "which bank THIS
 *   RAIL pays into". A HAND-RECORDED payment still takes a `bank_account`'s own
 *   `glAccountId` directly, unchanged.
 * - **A gateway does not get a NAMED role, and a channel does not get an account.**
 *   Still true: no role is ever named after one vendor (`clearing_affirm` was the one
 *   exception, retired 2026-09-10) and a channel is still a `dimensions` entry, never a
 *   second revenue role. What changed is that `CLEARING`, `PAYMENT_PROCESSING_FEES` and
 *   `BANK` may now resolve DIFFERENTLY per `payment_gateway` record via
 *   `GlRoleAssignment`'s rail scope — the account varies by rail, the role vocabulary
 *   does not.
 */
export const ACCOUNT_ROLES = {
  /**
   * Raw materials inventory (default `1310`). Debited at LANDED cost when a
   * component or a subassembly is received - `partKind` maps BOTH to this role
   * (plans/products/01-product-family.md §4).
   */
  INVENTORY_RAW_MATERIALS: 'inventory_raw_materials',
  /**
   * Work in process inventory (default `1320`).
   *
   * ⚠️ **Never emitted by a receipt.** Nothing in the `partKind` table maps to
   * it and receiving does not produce work in progress. It exists because a
   * build's own `inventory_movement` entry moves stock through it.
   */
  INVENTORY_WIP: 'inventory_wip',
  /**
   * Finished goods inventory (default `1330`). The other inventory account a
   * receipt can debit, when the part received is a finished good.
   *
   * ⚠️ Which of the two applies is NOT decided by a builder. It is the
   * movement's own frozen `stock_movement_gl_account`, resolved from `partKind`
   * at write time and summed by role in `build-inventory-movement-entry.ts`.
   */
  INVENTORY_FINISHED_GOODS: 'inventory_finished_goods',
  /** Accounts payable (default `2000`). Credited for the vendor bill total. */
  ACCOUNTS_PAYABLE: 'accounts_payable',
  /**
   * Payroll clearing (default `2110`). Standard assembly labour absorbed into
   * inventory comes OUT of this pool in the L1 month-end entry - that handshake
   * is the reason the account exists (04-books §2.1).
   */
  PAYROLL_CLEARING: 'payroll_clearing',
  /**
   * Inbound freight and brokerage accrual (default `2150`). Holds the carrier's
   * share - and the customs BROKER's service charge - until each bills.
   *
   * ⚠️ The role name says `freight` and the account says freight & brokerage.
   * That is deliberate (`G17`): a shipment-attributable broker charge IS landed
   * cost and clears here, while renaming the role would be a vocabulary
   * migration across the ledger for no behavioural gain. The ACCOUNT is what a
   * bookkeeper reads; the role is what a builder emits.
   */
  FREIGHT_ACCRUAL: 'freight_accrual',
  /**
   * Goods received not invoiced (default `2160`). Credited on receipt at the
   * VENDOR unit price, debited again at the same figure when the vendor's bill
   * arrives, which is what makes the accrual close to zero per line.
   */
  GRNI: 'grni',
  /**
   * Duties accrual (default `2170`). Tariffs and customs duties owed
   * **separately to the U.S. government**.
   *
   * 🛑 NOT the customs broker's share. The broker sells a service on a
   * shipment, so their charge is inbound freight's problem and clears through
   * `FREIGHT_ACCRUAL`'s broadened account (`G17`). Three files used to say
   * otherwise; they were wrong, and pointing a broker invoice at 2170 would
   * overstate the duty liability and understate landed freight.
   *
   * Only ever appears when there is a non-zero tariff portion. Build plan phase
   * 0.1 asks whether `tariffRate` is ever non-zero at all; if the answer is no,
   * the org simply leaves this role unmapped and no line will ever reference it
   * - a zero portion simply produces no line.
   */
  DUTIES_ACCRUAL: 'duties_accrual',
  /**
   * COGS - product cost (default `5000`). The balancing figure of the L1
   * month-end entry, and the account parts purchases must be coded to off the
   * bank feed for that entry to have anything to reclassify (04-books §2.1).
   *
   * 🛑 **Named "product cost", not "materials", because it holds more than
   * materials and cannot be made to hold less.** The month-end entry credits
   * the FULL labour and overhead absorbed this period out of `2110` and `5020`,
   * but a unit that ships carries its whole frozen cost - materials, labour and
   * overhead together - out of finished goods. The difference lands here.
   *
   * Under L1 it held the labour and overhead of a shipped unit as well, for want
   * of anywhere to split them to. 73 §6.2 rule 3 gives relief the finished
   * good's own frozen composition, so it lands across this,
   * {@link ACCOUNT_ROLES.COGS_DIRECT_LABOR} and
   * {@link ACCOUNT_ROLES.APPLIED_OVERHEAD} instead.
   */
  COGS_PRODUCT_COST: 'cogs_product_cost',
  /**
   * COGS - direct labour (default `5010`). The labour share of a relieved unit,
   * read off the finished good's frozen `part_standard_labor_cost` (73 §6.2
   * rule 3).
   */
  COGS_DIRECT_LABOR: 'cogs_direct_labor',
  /**
   * COGS - applied overhead (default `5020`). Overhead absorbed into inventory
   * this period, credited by the L1 month-end entry.
   */
  APPLIED_OVERHEAD: 'applied_overhead',
  /**
   * Purchase price variance (default `5090`). Absorbs the difference between
   * what we accrued on receipt and what the vendor actually billed. Debit when
   * billed high, credit when billed low.
   */
  PPV: 'ppv',
  /**
   * Inventory count variance (default `5095`). Where the value of a hand-keyed
   * count correction lands - shrinkage, breakage, a recount that found three
   * more than the system thought.
   *
   * 🛑 **Separate from `PPV` on purpose** (`G12`). Purchase price variance is
   * "the vendor billed something other than what we accrued"; count variance is
   * "the shelf disagrees with the ledger". They have different owners, different
   * remedies and different trends, and one account holding both answers neither
   * question. Placed at `5095` so it and `5090` read as siblings.
   */
  INVENTORY_COUNT_VARIANCE: 'inventory_count_variance',
  /**
   * Build variance (default `5091`). Scrap, and a run that did not close to the
   * parent's standard.
   *
   * 🛑 **Not `ppv`** (73 §6.2 rule 5). A build's residual is "the shop floor
   * consumed something other than the bill of materials says"; purchase price
   * variance is "the vendor billed other than we accrued". Different owner,
   * different remedy - the same argument `G12` makes for count variance.
   */
  BUILD_VARIANCE: 'build_variance',
  /**
   * Inventory revaluation (default `5092`). The other leg of a `revalue`
   * movement: a standard-cost roll restating what the on-hand units are worth,
   * and the first receipt of a provisional part replacing the guess it was
   * valued at (73 §6.2 rule 2, §6.4).
   */
  INVENTORY_REVALUATION: 'inventory_revaluation',
  /**
   * Purchase tax (default `5040`). Tax a vendor charges on a goods bill, which
   * is not in the landed formula and is deliberately kept out of the standard
   * (73 §7.2). An org that puts it in `vendor_part_other_cost` instead accrues
   * it with freight and never references this.
   */
  PURCHASE_TAX: 'purchase_tax',

  // ── Added 2026-09-04 by plans/accounting/HANDOFF.md wave 0 (slot 0A) ──────
  // The roles the revenue, payment, deposit, opening-balance and statement work
  // emits. Each is seeded onto a default account in `default-chart.ts`; the
  // `default-chart.test.ts` pin refuses a role no account carries.

  /**
   * Accounts receivable (default `1100`). Debited when an invoice is issued
   * (fulfillment entry), credited when a payment is received. ONE receivable
   * account carries the role whatever the channel - decision 6.1 in the handoff.
   */
  ACCOUNTS_RECEIVABLE: 'accounts_receivable',
  /**
   * Undeposited funds (default `1050`). A clearing account whose job is to be
   * ZERO once every bank deposit has cleared: cheques and cash land here when
   * received and leave as one `bank_deposit` entry per bank run, so one ledger
   * line matches one bank transaction (tasks/06 §1).
   */
  UNDEPOSITED_FUNDS: 'undeposited_funds',
  /**
   * Card clearing (default `1200`). Card revenue lands here gross at the sale
   * and is relieved net by the payout entry; the residual is the processing
   * fee. Reconciles to zero per payout.
   *
   * 🛑 Named for the RAIL, not for a provider. It was `clearing_shopify` /
   * `1200 Shopify Clearing` until entity migration 132, which was wrong in a way
   * that reconciled perfectly and read as a lie: there is no Shopify payment
   * rail in auxx at all - `PaymentTransaction.provider` is `manual | stripe` -
   * so every Stripe card receipt was accumulating in an account named for a
   * provider the money never touched.
   */
  CLEARING: 'clearing',
  /**
   * Bank (no default account - §3 rule 3 of task 58). The payout's deposit
   * leg. Always rail-scoped: "which bank" has no org-wide answer, so an
   * unscoped row is illegal (`ROLES_WITHOUT_DEFAULT`).
   */
  BANK: 'bank',
  /**
   * Unidentified receipts (default `2450`). Money that arrived and auxx cannot
   * attribute, held as a LIABILITY until somebody codes it.
   *
   * 🛑 The payout entry is what fills this. A gateway payout settles every
   * charge the merchant took, INCLUDING charges taken outside auxx, which were
   * never debited to `clearing`. Crediting the payout's full gross to
   * clearing would drive that account permanently negative by the amount auxx
   * never took; posting only the recognised part and leaving cash short of the
   * bank would break the bank reconciliation instead. So cash takes the whole
   * deposit, clearing is relieved of exactly what auxx put in it, and the
   * remainder lands here where it is visible and someone must work it.
   *
   * ⚠️ A liability rather than income ON PURPOSE. Until it is attributed,
   * "we hold money we cannot explain" is the true statement; recognising it as
   * revenue would book income on the strength of not knowing what it is.
   */
  UNIDENTIFIED_RECEIPTS: 'unidentified_receipts',
  /** Sales tax payable (default `2200`). A pass-through liability, never revenue. */
  SALES_TAX_PAYABLE: 'sales_tax_payable',
  /**
   * Customer deposits (default `2350`). Money taken BEFORE delivery, a
   * liability. `money/payments/deposit.ts` is this concept; a BANK deposit is
   * `bank_deposit` and lands on `cash`, never here.
   */
  CUSTOMER_DEPOSITS: 'customer_deposits',
  /**
   * Retained earnings (default `3100`). Where the balance-sheet reader rolls
   * prior years' net income; a role because the reader must find it without
   * knowing the org's numbering.
   */
  EQUITY_RETAINED_EARNINGS: 'equity_retained_earnings',
  /**
   * Opening balance equity (default `3900`). The balancing leg of the opening
   * STOCK run, which raises inventory against nothing else (MIGRATION step 5).
   */
  EQUITY_OPENING_BALANCE: 'equity_opening_balance',
  /**
   * Product revenue (default `4000`), every channel. The channel is a
   * `dimensions.channel` value on the line (brief 13 §5), never a second
   * role or a second account: `revenue_dtc` and `revenue_dealer` were retired
   * into this one on 2026-09-10.
   */
  REVENUE_PRODUCT: 'revenue_product',
  /** Shipping revenue (default `4020`). Its own account per handoff decision 6.3. */
  REVENUE_SHIPPING: 'revenue_shipping',
  /**
   * Service revenue (default `4030`). The credit leg of the `invoice_issued`
   * entry.
   *
   * 🛑 **Not a second product-revenue account.** `revenue_dtc` and
   * `revenue_dealer` are credited on SHIPMENT by the fulfillment entry, sourced
   * on an `order`. This one is credited on ISSUANCE, sourced on an `invoice`.
   * `invoice` and `order` are disjoint document families - there is no order
   * field on an invoice and no invoice field on an order, in either direction -
   * so no code path can produce both for one sale and the system cannot
   * double-count. A human hand-keying an invoice for a sale that also shipped
   * as an order still can, which is a release-note line, not a builder's job.
   */
  REVENUE_SERVICE: 'revenue_service',
  /**
   * Sales returns and allowances (default `4090`). The contra-revenue account a
   * refund reverses recognised revenue through.
   *
   * 🛑 **Not a debit back to `revenue_dtc` / `revenue_dealer` / `revenue_service`.**
   * QuickBooks defaults to the original income account; auxx does not
   * (task 47 §6.1), because netting the reversal into the account the sale was
   * credited to leaves the return rate invisible on the P&L, and a return rate
   * nobody can see is one nobody manages.
   *
   * ⚠️ The role covers ALLOWANCES as well as returns, and the allowance is the
   * common case: a post-sale price reduction where the customer keeps the goods
   * (47 §3.1). Nothing comes back and nothing restocks - the transaction price
   * changed. Reading this role as "returns" would put concessions somewhere
   * else and split one figure across two accounts.
   *
   * ⚠️ A REVENUE account that runs debit-normal. `GlAccountType` has no contra
   * classification and does not need one, the same reading `1190 Allowance for
   * Doubtful Accounts` gets: contra is presentation, not a posting rule.
   */
  REVENUE_RETURNS_ALLOWANCES: 'revenue_returns_allowances',
  /**
   * Payment processing fees (default `6100`). What the processor withheld from
   * a payout. NOT `money/payments/fees.ts`, which is the Connect application
   * fee auxx charges, a different number.
   */
  PAYMENT_PROCESSING_FEES: 'payment_processing_fees',
  /** Bad debt expense (default `6300`). The `write_off` entry's debit leg. */
  BAD_DEBT_EXPENSE: 'bad_debt_expense',
} as const

export type AccountRole = (typeof ACCOUNT_ROLES)[keyof typeof ACCOUNT_ROLES]

/**
 * The statement classification each role's account MUST carry.
 *
 * DECLARED, never derived at runtime. `G19` requires that every close
 * revalidates type compatibility, and the only way a revalidation can catch
 * anything is if the expectation was written down independently of the chart it
 * is checking. Deriving "grni is a liability" from the seeded default chart
 * would make the check tautological: repoint the role at a revenue account and
 * the derivation would happily follow it.
 *
 * `resolveRoles` fails CLOSED on a mismatch, naming the role, the account and
 * both types. An org may legitimately move `grni` from `2160` to `2155`; it may
 * not point it at an expense account, because the resulting entry would still
 * balance and nothing downstream could detect it.
 *
 * Pinned to {@link ACCOUNT_ROLES} by an exact-key-equality test - a role with no
 * declared type would otherwise pass validation unchecked.
 */
export const ROLE_ACCOUNT_TYPES: Record<AccountRole, GlAccountTypeValue> = {
  inventory_raw_materials: 'asset',
  inventory_wip: 'asset',
  inventory_finished_goods: 'asset',
  accounts_payable: 'liability',
  payroll_clearing: 'liability',
  freight_accrual: 'liability',
  grni: 'liability',
  duties_accrual: 'liability',
  cogs_product_cost: 'expense',
  cogs_direct_labor: 'expense',
  applied_overhead: 'expense',
  ppv: 'expense',
  inventory_count_variance: 'expense',
  build_variance: 'expense',
  inventory_revaluation: 'expense',
  purchase_tax: 'expense',
  accounts_receivable: 'asset',
  undeposited_funds: 'asset',
  clearing: 'asset',
  bank: 'asset',
  unidentified_receipts: 'liability',
  sales_tax_payable: 'liability',
  customer_deposits: 'liability',
  equity_retained_earnings: 'equity',
  equity_opening_balance: 'equity',
  revenue_product: 'revenue',
  revenue_shipping: 'revenue',
  revenue_service: 'revenue',
  revenue_returns_allowances: 'revenue',
  payment_processing_fees: 'expense',
  bad_debt_expense: 'expense',
}

/**
 * The subtype pin beside {@link ROLE_ACCOUNT_TYPES} (§3 rule 4 of task 58): a
 * second, narrower requirement present for exactly two roles. `bank` must
 * carry `GlAccountSubtype.BANK`; `clearing` must carry `GlAccountSubtype.CLEARING`.
 * Every other role pins nothing here and only its statement type applies.
 */
export const ROLE_ACCOUNT_SUBTYPES: Readonly<Partial<Record<AccountRole, GlAccountSubtypeValue>>> =
  {
    [ACCOUNT_ROLES.BANK]: GlAccountSubtype.BANK,
    [ACCOUNT_ROLES.CLEARING]: GlAccountSubtype.CLEARING,
  }

/**
 * Roles with no org-wide default (§3 rule 3 of task 58): `bank` has no answer
 * that holds for the whole org, so an unscoped row is illegal, not merely
 * unusual.
 */
export const ROLES_WITHOUT_DEFAULT = ['bank'] as const

/**
 * A human label per role, for the one place a role is ever shown to a person:
 * the build ledger card, which renders a movement's frozen
 * `stock_movement_gl_account`.
 *
 * Lives here rather than in the resource registry because the registry copy
 * (`GlAccountRole`) is gone - it existed only to supply a SINGLE_SELECT's
 * options, and `G19` replaced that field with `GlRoleAssignment`. Client-safe:
 * this file has no db, no logger and no io.
 */
export const ACCOUNT_ROLE_LABELS: Record<AccountRole, string> = {
  inventory_raw_materials: 'Inventory — Raw Materials',
  inventory_wip: 'Inventory — Work in Process',
  inventory_finished_goods: 'Inventory — Finished Goods',
  accounts_payable: 'Accounts Payable',
  payroll_clearing: 'Payroll Clearing',
  freight_accrual: 'Inbound Freight & Brokerage Accrual',
  grni: 'Goods Received Not Invoiced',
  duties_accrual: 'Duties Accrual',
  cogs_product_cost: 'COGS - Product Cost',
  cogs_direct_labor: 'COGS — Direct Labor',
  applied_overhead: 'COGS — Applied Overhead',
  ppv: 'Purchase Price Variance',
  inventory_count_variance: 'Inventory Count Variance',
  build_variance: 'Build Variance',
  inventory_revaluation: 'Inventory Revaluation',
  purchase_tax: 'Purchase Tax',
  accounts_receivable: 'Accounts Receivable',
  undeposited_funds: 'Undeposited Funds',
  clearing: 'Clearing',
  bank: 'Bank',
  unidentified_receipts: 'Unidentified Receipts',
  sales_tax_payable: 'Sales Tax Payable',
  customer_deposits: 'Customer Deposits',
  equity_retained_earnings: 'Retained Earnings',
  equity_opening_balance: 'Opening Balance Equity',
  revenue_product: 'Product Revenue',
  revenue_shipping: 'Shipping Revenue',
  revenue_service: 'Service Revenue',
  revenue_returns_allowances: 'Sales Returns and Allowances',
  payment_processing_fees: 'Payment Processing Fees',
  bad_debt_expense: 'Bad Debt Expense',
}

/**
 * Which axis of a posted event a SCOPABLE role reads its scope from
 * (task 47 §4, the `rail` axis added by task 58 §3).
 *
 * `store` keys the existing `GlRoleAssignment.sourceAccountId` column against
 * `FinancialSourceAccount` - unchanged from 47. `rail` is a SEPARATE column,
 * `GlRoleAssignment.paymentGatewayId`, against the `payment_gateway`
 * EntityInstance directly, because a rail row also carries an optional
 * `currency` the store axis has no counterpart for (58 §4.1).
 *
 * | axis | reads | answers |
 * | --- | --- | --- |
 * | `store` | `sourceStoreId`, null -> the manual row | which storefront sold it |
 * | `rail` | `effect.paymentGatewayId` | which payment rail took the money |
 */
export type ScopeAxis = 'store' | 'rail'

/**
 * The roles an org may answer DIFFERENTLY PER SCOPE, and the axis each reads
 * (task 47 §4, restructured by task 58 §3 rule 5).
 *
 * 🔑 **The vocabulary stays closed.** No role is added by scoping and no builder
 * changes: a fulfillment still emits `revenue_product`. What changes is that the
 * org may point `revenue_product` at `4001 Revenue - Auxx-Lift US` for one store
 * and leave every other store on the org-wide default (task 47 §1.2).
 *
 * 🛑 **Fees are NOT a store axis.** A store using two rails would pool both
 * rails' fees, and two stores sharing one Stripe account would split fees that
 * arrive on a single statement and reconcile as one number. `clearing` and
 * `bank` read the same rail axis for the same reason: each is an answer to
 * "which rail", never "which store" (58 §3).
 *
 * 🛑 **`cogs_product_cost` is WANTED and BLOCKED, not excluded** (47 §4.2).
 * Splitting revenue per store while COGS pools makes gross margin per store
 * uncomputable. It cannot be added today for a mechanical reason: COGS is
 * emitted only by `build-month-end-inventory.ts` - an org-wide plug against a
 * subledger total, which has no `sourceStoreId` and by construction cannot have
 * one. Scoped now, every COGS line would resolve through the manual bucket while
 * the per-store accounts sat at zero forever. It joins this table when 61 I2
 * puts COGS on the inventory entry.
 *
 * Everything else is deliberately out, and 47 §4.3 carries the reasoning per
 * role: `accounts_receivable` is settled by cash rather than by store,
 * `sales_tax_payable` is one obligation per jurisdiction, inventory is one
 * physical pool, `unidentified_receipts` wants ONE place to look, and
 * `revenue_service` is credited on an invoice, which is always manual.
 *
 * A write naming any other role with a `sourceAccountId` or `paymentGatewayId`
 * is refused by `setRoleAssignment`, and `__tests__/build-entry.test.ts` pins
 * this set the same way it pins {@link ROLE_ACCOUNT_TYPES}.
 */
export const SCOPABLE_ROLES: Readonly<Partial<Record<AccountRole, ScopeAxis>>> = {
  [ACCOUNT_ROLES.REVENUE_PRODUCT]: 'store',
  [ACCOUNT_ROLES.REVENUE_SHIPPING]: 'store',
  [ACCOUNT_ROLES.REVENUE_RETURNS_ALLOWANCES]: 'store',
  [ACCOUNT_ROLES.CLEARING]: 'rail',
  [ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES]: 'rail',
  [ACCOUNT_ROLES.BANK]: 'rail',
}

/** The axis `role` resolves its scope from, or null when it is not scopable. */
export function roleScopeAxis(role: string): ScopeAxis | null {
  return SCOPABLE_ROLES[role as AccountRole] ?? null
}

/**
 * Whether the MANUAL bucket is a meaningful source for this role.
 *
 * ⚠️ Derived from the axis rather than declared in a second table, which would
 * be a copy that drifts. A manual order has no rail, so
 * `payment_processing_fees` is never emitted for one and the settings tree greys
 * that cell rather than offering it (47 §4.3).
 */
export function roleAcceptsManualSource(role: string): boolean {
  return roleScopeAxis(role) === 'store'
}

export interface BuildEntryInput {
  postingType: PostingType
  periodKey: string
  /** `YYYY-MM-DD`. */
  txnDate: string
  lines: GlPostingLineInput[]
}

/** A line as the builders express it, before zero legs are dropped and ordered. */
interface DraftLine {
  accountRole: string
  direction: 'debit' | 'credit'
  amount: number
  memo?: string
  /** Set only on a receivable or payable draft (brief 13 §1.2). */
  counterpartyType?: CounterpartyType
  counterpartyId?: string
}

// `isAtPrecision(amount)` with no decimals is `Number.isFinite && Number.isInteger`; this wraps it in the AuxxError this file's callers need (`@auxx/utils` can't throw one).
function assertMinorUnits(amount: number, label: string): void {
  if (!isAtPrecision(amount)) {
    throw new UnprocessableEntityError(
      `${label} must be an integer number of minor units, got ${String(amount)}`,
      { amount: String(amount) }
    )
  }
}

/**
 * Build a balanced entry from explicit lines.
 *
 * **This is the balance gate, and it is the reason the file exists.** The sum of
 * debits must equal the sum of credits, in integer minor units, before anything
 * is persisted or pushed. QuickBooks enforces the same rule server-side with a
 * specific fault code (2300), but a provider-agnostic ledger cannot use its
 * provider as its validator: by the time the provider rejects, we have written a
 * `pending` `gl_posting` row and there is no entry anywhere to match it, and for
 * an org with NO provider connected nothing ever checks at all.
 *
 * Also rejected here, for the same reason - each of these produces an entry that
 * is wrong in a way no downstream reader can detect:
 *
 * - a non-integer or non-finite amount (minor units are integers; a float cent
 *   is a rounding bug that has already happened)
 * - a negative amount (sign lives in `direction`, only - see `GlPostingLineInput`)
 * - a zero amount (an entry leg that moves nothing; drop it upstream)
 * - a blank account role
 * - an entry with no lines, or with lines on only one side
 *
 * ⚠️ What this gate does NOT do is check that a role RESOLVES. That is a
 * database read against the org's own chart and it belongs to the resolver that
 * runs ahead of the claim, which fails closed on zero matches and - the one that
 * matters - on more than one. Keeping it out of here is what keeps this module
 * pure and exhaustively testable.
 *
 * @throws {UnprocessableEntityError} on any of the above.
 */
export function buildEntry(input: BuildEntryInput): BuiltEntry {
  const { postingType, periodKey, txnDate, lines } = input

  if (lines.length === 0) {
    throw new UnprocessableEntityError('A posting must have at least one line', {
      postingType,
      periodKey,
    })
  }

  let totalDebit = 0
  let totalCredit = 0

  for (const line of lines) {
    // A line names an account in exactly ONE of the three ways `GlPostingLineInput`
    // allows - a builder's ROLE, a human's CODE (HANDOFF slot 1A), or the
    // account's own ID (task 15: what a reversal carries so it lands where the
    // original did). None is the refusal below; more than one at once is the
    // other one, and it is refused rather than resolved by precedence, because a
    // precedence rule would silently post to whichever of two named accounts
    // this function happened to prefer. Read through a widened alias: the
    // union's `?: never` legs make TypeScript prove the several-at-once case
    // away, and a runtime check is still wanted because a tRPC caller or a JSON
    // round trip can produce it.
    const shape = line as { accountRole?: string; accountCode?: string; glAccountId?: string }
    const code = shape.accountCode?.trim()
    const id = shape.glAccountId?.trim()
    // Beside an id, a role is the SNAPSHOT the id variant lets a reversal carry
    // (see `GlPostingLineInput`), not a second naming; the id alone resolves.
    const role = id ? undefined : shape.accountRole?.trim()
    const named = role || code || id
    if (!named) {
      throw new UnprocessableEntityError(
        'A posting line must carry an account role, an account code or an account id',
        { postingType, periodKey }
      )
    }
    const namings = [role && `role '${role}'`, code && `code '${code}'`, id && `id '${id}'`].filter(
      Boolean
    )
    if (namings.length > 1) {
      throw new UnprocessableEntityError(
        `A posting line names both ${namings.join(' and ')}. It must name one.`,
        { postingType, periodKey }
      )
    }
    assertMinorUnits(line.amount, `Posting line amount for account ${named}`)
    if (line.amount < 0) {
      throw new UnprocessableEntityError(
        `Posting line amount must be positive - direction carries the sign (account ${named}, amount ${line.amount})`,
        { account: named, amount: String(line.amount) }
      )
    }
    if (line.amount === 0) {
      throw new UnprocessableEntityError(
        `Posting line amount must be non-zero (account ${named})`,
        { account: named }
      )
    }

    if (line.direction === 'debit') totalDebit += line.amount
    else totalCredit += line.amount
  }

  if (totalDebit !== totalCredit) {
    throw new UnprocessableEntityError(
      `Posting does not balance: debits ${totalDebit} != credits ${totalCredit}`,
      {
        postingType,
        periodKey,
        totalDebit: String(totalDebit),
        totalCredit: String(totalCredit),
      }
    )
  }

  // Both sides zero passes the equality above, which is exactly the entry that
  // is meaningless. Unreachable through the zero-amount check while there is at
  // least one line, but asserted so a future relaxation of that check cannot
  // quietly reintroduce it.
  if (totalDebit === 0) {
    throw new UnprocessableEntityError('Posting has no value on either side', {
      postingType,
      periodKey,
    })
  }

  return { postingType, periodKey, txnDate, lines, totalDebit, totalCredit }
}

/**
 * Drop zero legs, stamp the audit trail and the presentation order.
 *
 * Dropping zeros is deliberate and is not merely tidiness: a zero-amount leg
 * against a role the org has not mapped - duties accrual on an org that has
 * never paid a tariff - would fail the resolver, or force an account into the
 * chart and into every provider's chart, for no information at all.
 */
function materialize(
  drafts: DraftLine[],
  source: { sourceType: string; sourceId: string }
): GlPostingLineInput[] {
  return drafts
    .filter((draft) => draft.amount !== 0)
    .map((draft, index) => ({
      accountRole: draft.accountRole,
      direction: draft.direction,
      amount: draft.amount,
      memo: draft.memo,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sortOrder: index,
      counterpartyType: draft.counterpartyType,
      counterpartyId: draft.counterpartyId,
    }))
}

/**
 * The `sourceType` every vendor-bill line carries: the `vendor_bill` record.
 *
 * 🛑 One source type for both kinds of bill, because there is one record.
 * `reports/aging.ts` resolves a payable line whose `sourceType` is
 * `vendor_bill` through `vendor_bill_number`, `vendor_bill_due_at`,
 * `vendor_bill_vendor` and `vendor_bill_status`, giving the A/P aging its
 * label, its due-date bucket, its vendor group and its drawer link.
 */
export const VENDOR_BILL_SOURCE_TYPE = 'vendor_bill'

/** The posting type both kinds of bill claim (73 D3). Prefix `BIL`. */
export const VENDOR_BILL_POSTING_TYPE = 'vendor_bill' as const

/**
 * One line of the bill, as it is transcribed on the record.
 *
 * A line is LINKED (it names a `purchase_order_line`) or UNLINKED. The link is
 * what decides the debit, and nothing else does: a linked line relieves the
 * accrual its receipt raised, an unlinked line is coded to an account by hand.
 */
export interface VendorBillLineInput {
  /** The `vendor_bill_line` EntityInstance id. Named in a refusal. */
  lineId: string
  /**
   * `vendor_bill_line_line_total`, integer minor units. Signed: a negative line
   * (a credit the vendor put on the same document) posts on the other side.
   * THE one amount the ledger reads - see 73 §5.2.
   */
  lineTotalMinor: number | null | undefined
  /** `vendor_bill_line_description`, for the line memo and the refusal. */
  description?: string | null
  /** The `purchase_order_line` this line matches, when it names one. */
  purchaseOrderLineId?: string | null
  /** `vendor_bill_line_quantity_billed`. Read on a LINKED line only. */
  quantityBilled?: number | null
  /**
   * `purchase_order_line_expected_unit_price`, integer minor units - the agreed
   * price the receipt credited GRNI at. `null` on a linked line is a REFUSAL:
   * the line is untyped and there is nothing to relieve the accrual against.
   */
  unitPriceExpectedMinor?: number | null
  /**
   * `vendor_bill_line_gl_account`. Required on an UNLINKED line; missing is a
   * refusal naming the line, never a fallback account.
   */
  glAccountId?: string | null
  /** Shipping weight, for a `weight` allocation basis. */
  weight?: number | null
}

export interface VendorBillEntryInput {
  /** The `vendor_bill` EntityInstance id. Becomes every line's `sourceId`. */
  vendorBillId: string
  /**
   * OUR own reference (`'BILL-0007'`), off `vendor_bill_internal_number`. The
   * claim key and the document number's key.
   *
   * 🛑 Never `vendor_bill_number`, the VENDOR's: two vendors may print the same
   * string, and two bills on one period key means the loser converges to
   * `already_posted` - a SUCCESS - with its payable never recorded.
   */
  internalNumber: string
  /**
   * The claim and document-number key, when it is NOT the internal number.
   *
   * A repost after an edit passes one: the reversed original's claim row is
   * gone but its document number is still in the books, and re-keying on
   * `internalNumber` would mint that same number again. See
   * `purchasing/post-vendor-bill.ts`'s `vendorBillEntryKey`. The messages keep
   * naming the internal number either way.
   */
  periodKey?: string | null
  /** `YYYY-MM-DD`. The bill's own `billedAt` - the ACCOUNTING date, never today. */
  billedAt: string
  /** The bill's currency; refused when it differs from `ledgerCurrency`. */
  currency?: string | null
  /** The one currency the books are kept in. Omit to skip the currency check. */
  ledgerCurrency?: string
  /** The bill's lines, in display order. */
  lines: readonly VendorBillLineInput[]
  /** `vendor_bill_shipping_total`, integer minor units. */
  shippingMinor?: number | null
  /** `vendor_bill_tax_total`, integer minor units. */
  taxMinor?: number | null
  /** `vendor_bill_discount`, integer minor units, positive. */
  discountMinor?: number | null
  /** The order's `allocation_basis`. Defaults to `value`. */
  allocationBasis?: AllocationBasis
  /** `vendor_bill_total`, integer minor units, > 0. Transcribed, never computed. */
  totalMinor: number | null | undefined
  /**
   * The bill's own vendor - a `company` EntityInstance id - for the
   * counterparty on the `accounts_payable` line (brief 13 §1.2).
   *
   * 🛑 Required in practice even though the ledger posts without it: the
   * QuickBooks provider refuses a line on an `accounts_payable` account that
   * carries no counterparty, so an absent vendor makes the EXPORT fail.
   */
  vendorCompanyInstanceId?: string | null
  memo?: string
}

export interface BuiltVendorBillEntry {
  entry: BuiltEntry
  /** The claim key and the document number's key - `internalNumber` unless one was passed. */
  periodKey: string
  /** The payable raised. Equals the bill's stored total. */
  totalMinor: number
  /**
   * What each line bore of the header's shipping, tax and discount, in bill
   * order and reconciling to those headers to the cent. Nothing in the ledger
   * reads it - the header legs are one each - but 73 item 11's landed-cost
   * voucher is the split, so it is returned rather than recomputed later.
   */
  allocations: Array<{
    lineId: string
    shippingMinor: number
    taxMinor: number
    discountMinor: number
  }>
}

/** The one vendor-bill entry, for the Post action on either kind of bill (73 D2, D3, D5).
 *
 * ```
 * linked line     Dr grni                billed qty x expected price
 *                 Dr/Cr ppv              line total - billed x expected, less its discount share
 * unlinked line   Dr <its coded account> line total, less its discount share (signed)
 * shipping        Dr freight_accrual     the header, one leg      (the receipt accrued it)
 * tax             Dr purchase_tax        the header, one leg
 *                   Cr accounts_payable  vendor_bill_total        (counterparty: the vendor)
 * ```
 *
 * 🛑 **Billed-based, and verdict-independent** (73 D2). GRNI is debited at what
 * the vendor is BILLING at the agreed price, never at what was received. A short
 * receipt leaves a GRNI debit - *invoiced, not received* - which is the true
 * statement and which U7's vendor credit clears. The received-based formula that
 * stood here pushed the unreceived goods' cost into PPV as if it were a price
 * disagreement, which it is not yet.
 *
 * The entry ties to the bill's transcribed total or it refuses and names the
 * difference: `Σ line totals + shipping + tax - discount = total`. It never
 * plugs - a plug is a guess about which account the difference belongs in, and a
 * wrong guess balances perfectly and is invisible until somebody reads the P&L.
 *
 * @throws {UnprocessableEntityError} on a blank or over-long internal number, a
 *   currency that differs from the ledger's, a total that is not a positive
 *   whole number of minor units, an untyped linked line, an unlinked line with
 *   no `glAccount`, a tie that fails, or (via `buildEntry`) an entry that does
 *   not balance.
 */
export function buildVendorBillEntry(input: VendorBillEntryInput): BuiltVendorBillEntry {
  const { vendorBillId, billedAt, memo, vendorCompanyInstanceId } = input

  const number = assertCompactablePeriodKey({
    value: input.internalNumber,
    label: 'Bill reference',
    remedy:
      'Shorten the vendor bill sequence prefix, or record the payable with a manual journal ' +
      'entry instead.',
    context: { vendorBillId },
  })
  const periodKey = input.periodKey?.trim()
    ? assertCompactablePeriodKey({
        value: input.periodKey,
        label: 'Bill entry key',
        remedy: 'Shorten the vendor bill sequence prefix.',
        context: { vendorBillId },
      })
    : number

  const currency = input.currency?.trim() || input.ledgerCurrency
  if (input.ledgerCurrency && currency !== input.ledgerCurrency) {
    throw new UnprocessableEntityError(
      `Bill ${number} is in ${currency} and the ledger is kept in ${input.ledgerCurrency}. ` +
        'Posting it would use an implied 1.0 rate, so it is refused rather than mis-stated.',
      { vendorBillId, number, currency: String(currency), ledgerCurrency: input.ledgerCurrency }
    )
  }

  // `FieldValue.valueNumber` is a `doublePrecision` column, so `12000` can read
  // back as `11999.999999999998`. `toAmountMinor` rounds the double's own noise
  // floor and refuses a genuinely fractional value.
  const totalMinor = toAmountMinor(input.totalMinor, `Bill ${number} total`)
  if (totalMinor <= 0) {
    throw new UnprocessableEntityError(
      `Bill ${number} totals ${totalMinor}. A bill raises a payable, which is a positive whole ` +
        'number of minor units - a vendor credit is its own document, not a negative bill.',
      { vendorBillId, number, totalMinor: String(totalMinor) }
    )
  }

  const shippingMinor = toAmountMinor(input.shippingMinor, `Bill ${number} shipping`)
  const taxMinor = toAmountMinor(input.taxMinor, `Bill ${number} tax`)
  const discountMinor = toAmountMinor(input.discountMinor, `Bill ${number} discount`)

  // ── Every line read and refused before anything is built ─────────────────
  // Batched rather than fail-fast: a bill with four uncoded lines names all
  // four, so the bookkeeper fixes them in one pass instead of four.
  const uncoded: string[] = []
  const untyped: string[] = []
  const read: Array<{
    line: VendorBillLineInput
    label: string
    amountMinor: number
    /** Set on a linked line that is fully typed. */
    grniMinor: number | null
    glAccountId: string | null
  }> = []
  let lineSumMinor = 0

  for (const [index, line] of input.lines.entries()) {
    const label = line.description?.trim() || `Line ${index + 1}`
    const amountMinor = toAmountMinor(line.lineTotalMinor, `Bill ${number} ${label}`)
    lineSumMinor += amountMinor

    if (line.purchaseOrderLineId) {
      if (line.unitPriceExpectedMinor == null || line.quantityBilled == null) {
        untyped.push(label)
        continue
      }
      const grniMinor = Math.round(line.quantityBilled * line.unitPriceExpectedMinor)
      read.push({ line, label, amountMinor, grniMinor, glAccountId: null })
      continue
    }

    const glAccountId = line.glAccountId?.trim()
    // A zero line needs no account: `buildEntry` refuses a leg that moves
    // nothing, so it is dropped rather than refused. Checked after the drop.
    if (!glAccountId && amountMinor !== 0) {
      uncoded.push(label)
      continue
    }
    read.push({ line, label, amountMinor, grniMinor: null, glAccountId: glAccountId ?? null })
  }

  if (untyped.length > 0) {
    throw new UnprocessableEntityError(
      `Bill ${number} has ${untyped.length === 1 ? 'a line' : `${untyped.length} lines`} matched ` +
        `to a purchase order line with no quantity or agreed price to compare: ` +
        `${untyped.join(', ')}. Type the quantity billed, or unlink the line and code it to an ` +
        'account.',
      { vendorBillId, number, lines: untyped.join(', ') }
    )
  }

  if (uncoded.length > 0) {
    throw new UnprocessableEntityError(
      `Bill ${number} has ${uncoded.length === 1 ? 'a line' : `${uncoded.length} lines`} with no ` +
        `GL account: ${uncoded.join(', ')}. Code ${uncoded.length === 1 ? 'it' : 'them'} to an ` +
        'account, or match it to a purchase order line - there is no default expense account to ' +
        'fall back on, and guessing one puts real money somewhere nobody will ever look.',
      { vendorBillId, number, lines: uncoded.join(', ') }
    )
  }

  // ── The tie (73 §5.2) ────────────────────────────────────────────────────
  const tied = lineSumMinor + shippingMinor + taxMinor - discountMinor
  if (tied !== totalMinor) {
    const difference = totalMinor - tied
    throw new UnprocessableEntityError(
      `Bill ${number} totals ${totalMinor} but its lines, shipping, tax and discount come to ` +
        `${tied}, a difference of ${difference}. A bill's total is transcribed from the vendor's ` +
        'document and never recomputed, so the entry ties to it or it does not post. Correct ' +
        'whichever figure was mis-keyed rather than letting the difference land on an account ' +
        'nothing chose.',
      {
        vendorBillId,
        number,
        totalMinor: String(totalMinor),
        linesMinor: String(lineSumMinor),
        shippingMinor: String(shippingMinor),
        taxMinor: String(taxMinor),
        discountMinor: String(discountMinor),
        differenceMinor: String(difference),
      }
    )
  }

  const spread = spreadHeaders(
    read.map((row) => ({
      lineTotal: row.amountMinor,
      quantity: row.line.quantityBilled ?? 0,
      weight: row.line.weight ?? undefined,
    })),
    { shippingMinor, taxMinor, discountMinor, basis: input.allocationBasis ?? 'value' }
  )

  const drafts: DraftLine[] = []
  const idLines: GlPostingLineInput[] = []
  const source = { sourceType: VENDOR_BILL_SOURCE_TYPE, sourceId: vendorBillId }

  read.forEach((row, index) => {
    // The discount reduces what the line cost us: on a linked line that is a
    // favourable PPV credit, on a coded line a smaller debit (73 §5.2).
    const netMinor = row.amountMinor - (spread.discount[index] ?? 0)
    if (row.grniMinor !== null) {
      drafts.push({
        accountRole: ACCOUNT_ROLES.GRNI,
        direction: 'debit',
        amount: row.grniMinor,
        memo: `${row.label} - relieve goods received not invoiced`,
      })
      const ppvMinor = netMinor - row.grniMinor
      drafts.push({
        accountRole: ACCOUNT_ROLES.PPV,
        direction: ppvMinor >= 0 ? 'debit' : 'credit',
        amount: Math.abs(ppvMinor),
        memo: `${row.label} - purchase price variance`,
      })
      return
    }
    if (netMinor === 0 || !row.glAccountId) return
    idLines.push({
      ...source,
      // The IDENTITY, never a role and never a code: the expense account is the
      // BOOKKEEPER's own pick out of THEIR chart, and most of a chart carries no
      // auxx role at all. `buildEntry` refuses a line that names two.
      glAccountId: row.glAccountId,
      direction: netMinor > 0 ? ('debit' as const) : ('credit' as const),
      amount: Math.abs(netMinor),
      memo: row.label,
      sortOrder: 0,
    })
  })

  // The header legs, one each, decided by 73 §7.2: the receipt already accrued
  // the freight this vendor is billing on the same invoice, so shipping clears
  // that accrual; tax is not in the landed formula and is its own expense.
  drafts.push({
    accountRole: ACCOUNT_ROLES.FREIGHT_ACCRUAL,
    direction: 'debit',
    amount: shippingMinor,
    memo: `Bill ${number} - freight`,
  })
  drafts.push({
    accountRole: ACCOUNT_ROLES.PURCHASE_TAX,
    direction: 'debit',
    amount: taxMinor,
    memo: `Bill ${number} - purchase tax`,
  })
  drafts.push({
    accountRole: ACCOUNT_ROLES.ACCOUNTS_PAYABLE,
    direction: 'credit',
    amount: totalMinor,
    memo: memo ?? `Bill ${number}`,
    ...(vendorCompanyInstanceId
      ? { counterpartyType: 'vendor' as const, counterpartyId: vendorCompanyInstanceId }
      : {}),
  })

  const roleLines = materialize(drafts, source)
  const lines = [...idLines, ...roleLines].map((line, index) => ({ ...line, sortOrder: index }))

  return {
    entry: buildEntry({
      postingType: VENDOR_BILL_POSTING_TYPE,
      periodKey,
      txnDate: billedAt,
      lines,
    }),
    periodKey,
    totalMinor,
    allocations: read.map((row, index) => ({
      lineId: row.line.lineId,
      shippingMinor: spread.shipping[index] ?? 0,
      taxMinor: spread.tax[index] ?? 0,
      discountMinor: spread.discount[index] ?? 0,
    })),
  }
}

/**
 * The three header amounts spread over the lines, each reconciling to its header
 * exactly.
 *
 * The discount is always by VALUE (73 §5.2); shipping and tax follow the order's
 * own basis. A basis that needs a quantity falls back to `value` when any line
 * carries none, because an expense bill's lines routinely do and refusing the
 * post over an allocation the ledger does not read would be the wrong trade.
 */
function spreadHeaders(
  lines: AllocationLine[],
  header: { shippingMinor: number; taxMinor: number; discountMinor: number; basis: AllocationBasis }
): { shipping: number[]; tax: number[]; discount: number[] } {
  const basis =
    header.basis !== 'value' && lines.some((line) => !(line.quantity > 0)) ? 'value' : header.basis
  // `allocateCapitalisedCost` refuses a non-positive quantity on any basis; under
  // `value` it never reads one, so the placeholder is invisible.
  const rows = lines.map((line) => ({ ...line, quantity: line.quantity > 0 ? line.quantity : 1 }))
  const one = (amount: number, only: AllocationBasis): number[] =>
    allocateCapitalisedCost(
      rows,
      { shipping: amount, tax: 0, discount: 0, taxRecoverable: false },
      only
    )
  return {
    shipping: one(header.shippingMinor, basis),
    tax: one(header.taxMinor, basis),
    discount: one(header.discountMinor, 'value'),
  }
}
