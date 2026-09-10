// packages/lib/src/postings/default-chart.ts
//
// The default chart of accounts auxx.ai seeds into an organization, declared
// as PACKS (plans/accounting/tasks/16-the-chart-of-accounts.md §1 and §3.2).
//
// PURE DATA. No database, no io - `postings/` already owns the account
// vocabulary (`ACCOUNT_ROLES` in build-entry.ts), the period keyspace and the
// provider seam, so the chart that vocabulary maps onto belongs here rather
// than in `seed/`. The seeder that writes these rows imports this module;
// `seed -> lib` is the sanctioned direction and `lib -> seed` is not.
//
// ## Why packs
//
// The flat 37-account list this file used to export was one company's chart:
// nine accounts carried no role at all and sixteen carried roles only a
// manufacturer, a purchaser or a card merchant ever drives. Brief 16 §1 splits
// the same table by WHO reaches it: a `core` every org gets (the eleven roles an
// enabled posting type can put on a line for any org that sends an invoice,
// takes a payment, ships an order, issues a credit memo or writes something
// off), and four packs an org adds when it starts doing the thing that needs
// them: `card_rail`, `prepayments`, `inventory`, `purchasing`. Every one of the
// 28 roles lives in exactly one pack; `packForRole` is the lookup and the union
// test in `__tests__/default-chart.test.ts` is the proof.
//
// ## Why the core then grew, and three more packs arrived
//
// Brief 21 §0.4 read the same table back and found the other half of the
// problem: the ONLY expense accounts in the whole catalogue were two merchant
// fee lines, bad debt and six COGS accounts. `bank_transaction` is a live
// posting type and a coded bank line posts against an account the operator
// PICKS, so no org could code a rent payment, a utility bill or an insurance
// premium without hand-creating the account first - one at a time, through
// `chartAccountCreate`, because the catalogue picker validates against this
// same table. A chart that cannot express rent is not a chart.
//
// So the ordinary operating expenses, `1400 Prepaid Expenses` and the two
// owner-equity movement accounts are CORE (21 DECIDED E): every org has them,
// and none of them carries a role, because no builder emits them. `payroll`,
// `fixed_assets` and `debt` are packs for the same reason `inventory` is - an
// org with no employees should not carry withholding accounts.
//
// 🟢 The accounting subsystem is not live (21 DECIDED 2): `GlPosting` is empty
// and entity migration 142 wiped every seeded chart, so all of that grew with
// no migration, no backfill and no compatibility path.
//
// Four accounts that were in the old list are in NO pack (`1190 Allowance for
// Doubtful Accounts`, `2100 Accrued Payroll`, `2400 Returns Reserve`, `6200
// Fulfillment Labor`): role-less, one company's bookkeeping, added by hand in
// the chart editor where wanted (16 DECIDED, 16.3). An org provisioned before
// packs existed keeps them; nothing here renumbers, renames or deletes.
//
// Packs are DECLARED, not derived from the builders or from
// `SINGLE_WRITER_ROLES_BY_POSTING_TYPE` (16 §1.6): a declared table is what a
// human comes to and says so; a derived one follows whatever a builder started
// emitting.
//
// The account CODE is optional on a `gl_account` now (task 15 §5) - a chart
// imported from a provider that ships with account numbers off has none, and
// a person may keep a chart by name alone. This default chart keeps ITS codes
// regardless (15.1 default): a numbered default is what every mandated chart
// does, and optional means importable, not absent.

import { GlAccountSubtype, GlAccountType } from '../resources/registry/enum-values'
import type { GlAccountSubtypeValue } from './account-subtype'
import type { AccountRole } from './build-entry'
import type { RoleAssignmentRow } from './types'

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

/**
 * The five statement classifications as a non-empty tuple, for a `z.enum`.
 *
 * Derived from `GlAccountType`'s NAMED members for the reason
 * {@link GlAccountTypeValue} gives: `values` widens `value` to `string`, so a
 * schema built from it would accept `'nonsense'`. Listed here rather than in the
 * registry because a router needs it client-safely and this module is already
 * the client-safe home of the type it is checked against.
 */
export const GL_ACCOUNT_TYPES = [
  GlAccountType.ASSET,
  GlAccountType.LIABILITY,
  GlAccountType.EQUITY,
  GlAccountType.REVENUE,
  GlAccountType.EXPENSE,
] as const satisfies readonly GlAccountTypeValue[]

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
  /**
   * The second fact beyond `accountType` (task 13 §3, pulled forward by task
   * 15 §5). Stamped where it replaces something a code prefix used to carry -
   * the bank, receivable, payable and inventory accounts, and every COGS
   * account under `5xxx` - so `profit-and-loss.ts` can group COGS by this
   * instead of testing `code.startsWith('5')`, which throws the moment a chart
   * has no codes at all.
   */
  subtype?: GlAccountSubtypeValue
}

/**
 * The eight packs, by key. `core` is always provisioned; the other seven are
 * chosen by a person in the wizard's pack picker or the Roles tab's Add
 * accounts action (16 §3). Never provisioned silently off a plan event, an app
 * install or a payout sync (16 §3.3).
 */
export type ChartPackKey =
  | 'core'
  | 'card_rail'
  | 'prepayments'
  | 'inventory'
  | 'purchasing'
  | 'payroll'
  | 'fixed_assets'
  | 'debt'

/** One provisionable slice of the default chart. */
export interface ChartPack {
  key: ChartPackKey
  /** Rendered in the picker: 'Card payments and payouts'. */
  label: string
  /** One sentence, rendered in the picker under the label. */
  description: string
  /** A pack whose roles this one's builders also drive. Provisioned first. */
  requires?: readonly ChartPackKey[]
  accounts: readonly DefaultChartAccount[]
}

// ─────────────────────────────────────────────────────────────────────────────
// The core: twenty-seven accounts, eleven roles (16 §1.3, 21 §4.2)
// ─────────────────────────────────────────────────────────────────────────────
//
// Two different arguments put an account here, and only the FIRST is about
// roles. Every role here is reachable by an ENABLED posting type on any org
// that sends an invoice, takes a payment, ships an order, issues a credit memo
// or writes something off (16 §0.2). The other fourteen accounts carry no role
// at all: they are here because a coded bank line, an owner's deposit or a
// prepaid insurance premium has nowhere else to go, and hand-creating an
// account per bank line is not a chart (21 DECIDED E). Why each of the arguable
// role-bearing ones is here:
//
// - `2000 Accounts Payable`: `vendor_bill` is not enabled, but A/P aging reads
//   the role, a manual journal to a payable by id is ordinary bookkeeping, and
//   every business owes somebody. Its subtype is what the QuickBooks seam uses
//   to demand a vendor on the line (13 §1).
// - `3900 Opening Balance Equity`: no builder emits the role and nothing reads
//   it, but the opening trial-balance grid needs the account to balance
//   against and QuickBooks has the account of the same name. The role stays
//   because the vocabulary is closed and a role no pack carried would fail the
//   union test.
// - `4000`, `4020`: `fulfillment` is enabled for every org and drops a zero
//   shipping leg, so an org that never ships simply never posts to them.
// - `6300`, `4090`, `4020`: one account each, driven by enabled types every org
//   reaches; an unmapped `bad_debt_expense` would turn a forty-dollar write-off
//   into a refusal that names a pack (16 DECIDED).
const CORE_ACCOUNTS: readonly DefaultChartAccount[] = [
  // ── Assets ──────────────────────────────────────────────────────────────
  {
    // Not in the accrual plan's table - added because `buildBillPaymentEntry`
    // credits it in ledger mode (decision P12). An org that already has a bank
    // account should repoint this role at it rather than keep a second one.
    code: '1000',
    name: 'Cash',
    accountType: GlAccountType.ASSET,
    // No role since brief 13 §2: a bank account is an instance, not a
    // function. An org maps this as a bank account like any other, or `16`
    // stops seeding it.
    //
    // 16.1 kept it seeded: a `bank_account` must point at a `gl_account` id,
    // the `cash` payment route needs `accounting.cashBankAccountId` to name
    // one, and the opening trial balance needs somewhere for cash to land. An
    // org that imports from QuickBooks gets its real bank accounts instead and
    // never sees `1000`.
    subtype: GlAccountSubtype.BANK,
  },
  {
    // A clearing account whose job is to be ZERO once every bank deposit has
    // cleared. Cheques and cash land here on receipt and leave as one
    // `bank_deposit` entry per bank run (tasks/06 §1). Numbered between cash
    // and receivables so it reads as the cash-in-transit it is.
    code: '1050',
    name: 'Undeposited Funds',
    accountType: GlAccountType.ASSET,
    role: 'undeposited_funds',
  },
  {
    // Was "Accounts Receivable - Dealers". Renamed by handoff decision 6.1:
    // ONE receivable account carries the role whatever the channel, and
    // migration 125 renames the seeded row where the org has not touched it.
    code: '1100',
    name: 'Accounts Receivable',
    accountType: GlAccountType.ASSET,
    role: 'accounts_receivable',
    subtype: GlAccountSubtype.ACCOUNTS_RECEIVABLE,
  },
  {
    // The company's OWN prepayments: insurance billed annually, a year of
    // software paid up front, a deposit lodged with a landlord. Held as an
    // asset and amortised into expense monthly, which is a recurring journal
    // template's exact shape (21 §1.7).
    //
    // 🛑 NOT the `prepayments` pack, and not a variant of it. That pack is
    // `2300 Deferred Revenue` and `2350 Customer Deposits` - money a CUSTOMER
    // paid us before we delivered, so we owe them either goods or the money
    // back. This is money WE paid a vendor before they delivered, so THEY owe
    // US. Opposite party, opposite side of the balance sheet; the only thing
    // the two share is the English word "prepaid".
    code: '1400',
    name: 'Prepaid Expenses',
    accountType: GlAccountType.ASSET,
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
    subtype: GlAccountSubtype.ACCOUNTS_PAYABLE,
  },
  {
    // Sales tax is NEVER revenue and never an expense - a pass-through
    // liability from the moment Shopify collects it (accrual plan §1).
    code: '2200',
    name: 'Sales Tax Payable',
    accountType: GlAccountType.LIABILITY,
    role: 'sales_tax_payable',
  },

  // ── Equity ──────────────────────────────────────────────────────────────
  // Added 2026-09-04 (handoff decision 6.4). The opening trial balance needs an
  // equity leg to post against and the balance sheet needs a retained-earnings
  // home; without both the ledger could hold activity but never a position.
  {
    // The org's own equity. No role: nothing auxx posts touches it, and the
    // statement reader groups it by type.
    code: '3000',
    name: "Owner's Equity",
    accountType: GlAccountType.EQUITY,
  },
  // 3010 and 3020 added by 21 §4.2, and CORE rather than the `debt` pack or one
  // of their own. An owner putting personal money into the business is one of
  // the first bank lines a new company ever has, and a founder's deposit with
  // nowhere to land is the same gap as rent with nowhere to land - the argument
  // that made the operating expenses core (21 DECIDED E). A loan is not: a
  // company may never take one, which is why the debt accounts are a pack and
  // these are not. 3000 is already core, so the equity story stays in one place.
  {
    // Money the owner put IN. Its own account rather than a credit straight to
    // 3000 so the year's movement is visible; a bookkeeper closes it to 3000 at
    // year end if they want to, exactly as they clear 3900.
    code: '3010',
    name: 'Owner Contributions',
    accountType: GlAccountType.EQUITY,
  },
  {
    // Money the owner took OUT. 🛑 A draw is a return of capital and never
    // appears on the P&L - coding one to an expense account is the single most
    // common small-company bookkeeping error, and the account existing by name
    // is the cheapest thing that prevents it.
    code: '3020',
    name: 'Owner Draws',
    accountType: GlAccountType.EQUITY,
  },
  {
    // Where prior years' net income rolls. A role because the balance-sheet
    // reader must find it without knowing the org's numbering.
    code: '3100',
    name: 'Retained Earnings',
    accountType: GlAccountType.EQUITY,
    role: 'equity_retained_earnings',
  },
  {
    // The balancing leg of the opening entry. A bookkeeper clears it to 3000
    // or 3100 with a manual journal once the opening balances are agreed -
    // exactly what QuickBooks does with the account of the same name.
    code: '3900',
    name: 'Opening Balance Equity',
    accountType: GlAccountType.EQUITY,
    role: 'equity_opening_balance',
  },

  // ── Revenue ─────────────────────────────────────────────────────────────
  {
    // 4000 and 4010 stay SEPARATE from day one. Blended into one account, a
    // shift in channel mix looks like a margin problem with no visible cause
    // (accrual plan §3).
    code: '4000',
    name: 'Product Revenue',
    accountType: GlAccountType.REVENUE,
    role: 'revenue_product',
  },
  {
    // Its own account rather than folded into product revenue (handoff
    // decision 6.3): shipping charged to customers is not product margin.
    code: '4020',
    name: 'Shipping Revenue',
    accountType: GlAccountType.REVENUE,
    role: 'revenue_shipping',
  },
  {
    // The service side's revenue, credited when an INVOICE is issued
    // (plans/accounting/tasks/08-invoice-revenue.md). Separate from `4000` and
    // `4010` because those are the product side and are credited on SHIPMENT
    // by the fulfillment entry; an invoice has no shipment, so issuance is the
    // only event there is.
    //
    // ONE service revenue account, not a per-line mapping. A line-level
    // revenue account is a real want and a much larger change - a field on
    // `line_item` or the catalog item, plus a resolver and a fallback - and
    // splitting this later is a chart edit plus a resolver, not a rewrite of
    // the builder.
    code: '4030',
    name: 'Service Revenue',
    accountType: GlAccountType.REVENUE,
    role: 'revenue_service',
  },
  {
    // A contra-revenue account, and its own account rather than a debit back
    // to the revenue account the sale was credited to - which is what
    // QuickBooks defaults to (task 47 §6.1). Netting the reversal into `4000`
    // leaves a return rate that never appears on the P&L, and a return rate
    // nobody can see is one nobody manages.
    //
    // 🛑 **"and Allowances" is carrying weight, not padding.** The dominant
    // case by count is a CONCESSION - a post-sale price reduction where the
    // customer keeps the goods (47 §3.1) - which is an allowance, not a
    // return. A name that said only "Returns" would misdescribe most of what
    // lands here.
    //
    // `GlAccountType` has no contra classification and does not need one, the
    // same reading `1190 Allowance for Doubtful Accounts` gets: contra is a
    // presentation attribute, not a posting rule. The account is REVENUE and
    // simply runs debit-normal.
    code: '4090',
    name: 'Sales Returns and Allowances',
    accountType: GlAccountType.REVENUE,
    role: 'revenue_returns_allowances',
  },

  // ── Operating expenses ──────────────────────────────────────────────────
  // 6000 to 6090 and 6900 added by 21 §4.2. The smallest set that lets a real
  // small company code a bank feed from end to end without inventing an
  // account; an org that wants a finer breakdown adds its own, which is what a
  // default chart is for (`G7`). None of them carries a role and that is the
  // ordinary case, not a gap: no builder emits any of them, the statement
  // reader groups them by type, and `ACCOUNT_ROLES` is a closed vocabulary tied
  // to builders (16 §4.2), so a role invented here would name nothing.
  {
    // Its own line rather than folded into 6900. For most orgs auxx serves this
    // is the largest operating expense there is, and an expense nobody can see
    // is one nobody manages - the argument 4090 makes about return rates.
    code: '6000',
    name: 'Advertising and Marketing',
    accountType: GlAccountType.EXPENSE,
  },
  {
    code: '6010',
    name: 'Rent',
    accountType: GlAccountType.EXPENSE,
  },
  {
    code: '6020',
    name: 'Utilities',
    accountType: GlAccountType.EXPENSE,
  },
  {
    // The company's own general cover. Employee health cover is a cost of
    // employing somebody and belongs to `6420` in the payroll pack.
    code: '6030',
    name: 'Insurance',
    accountType: GlAccountType.EXPENSE,
  },
  {
    code: '6040',
    name: 'Software and Subscriptions',
    accountType: GlAccountType.EXPENSE,
  },
  {
    // Accountants, lawyers, outside consultants. A contractor doing the work of
    // an employee is still a professional fee and never payroll: no
    // withholding, no employer tax, nothing for the payroll pack to clear.
    code: '6050',
    name: 'Professional Fees',
    accountType: GlAccountType.EXPENSE,
  },
  {
    code: '6060',
    name: 'Office Supplies',
    accountType: GlAccountType.EXPENSE,
  },
  {
    // ONE account, not travel and meals apart. The meals deduction split is a
    // tax-return question the firm answers at year end off a memo, and asking
    // an operator to route a card line correctly for it buys nothing.
    code: '6070',
    name: 'Travel and Meals',
    accountType: GlAccountType.EXPENSE,
  },
  {
    code: '6080',
    name: 'Repairs and Maintenance',
    accountType: GlAccountType.EXPENSE,
  },
  {
    // What the BANK charges: account fees, wires, returned items. Numbered
    // beside `6100 Merchant Fees - Cards` so the two read as a pair in a sorted
    // chart, but core rather than `card_rail` - every org has a bank account
    // and only a card merchant has 6100.
    code: '6090',
    name: 'Bank Charges',
    accountType: GlAccountType.EXPENSE,
  },
  {
    // The `write_off` entry's debit leg. `1190 Allowance for Doubtful Accounts`
    // is the contra-asset the reserve method would credit; the direct
    // write-off posts here and credits receivables.
    code: '6300',
    name: 'Bad Debt Expense',
    accountType: GlAccountType.EXPENSE,
    role: 'bad_debt_expense',
  },
  {
    // The catch-all, numbered at the end of the band so it sorts last. A coded
    // bank line must always have somewhere to go; the alternative to this
    // account is an operator inventing one per unfamiliar charge, which is how
    // a chart becomes forty accounts nobody agreed to.
    code: '6900',
    name: 'Other Operating Expense',
    accountType: GlAccountType.EXPENSE,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// card_rail: Stripe Connect, Shopify Payments, Affirm (16 §1.4)
// ─────────────────────────────────────────────────────────────────────────────
//
// `seedDefaultPaymentGateways` runs after this pack, never after the core: the
// two default gateway records point at `clearing_card` / `clearing_affirm`,
// which only exist once this pack has landed (13 §5.3, 16 §1.5). `6105` rides
// with the rail because Affirm's fees clear `1210` (16 §1.6).
const CARD_RAIL_ACCOUNTS: readonly DefaultChartAccount[] = [
  {
    // Named for the RAIL. Was `Shopify Clearing` / `clearing_shopify` until
    // entity migration 132 - there is no Shopify payment rail in auxx, so the
    // Stripe money sitting here was in an account named for a provider it never
    // touched. The code is unchanged; only the name and the role moved.
    code: '1200',
    name: 'Card Clearing',
    accountType: GlAccountType.ASSET,
    role: 'clearing_card',
  },
  {
    // Must EXCLUDE every Affirm-gateway order or 1200 can never reconcile to
    // zero: an Affirm settlement never lands on the card rail, so it is
    // invisible to the payouts API (accrual plan §3).
    //
    // The role is what makes that exclusion mechanical rather than a rule
    // somebody has to remember: the fulfillment debit fork routes an `affirm`
    // gateway to `clearing_affirm`, and `PAYOUT_CLEARING_ROLES` holds
    // `clearing_card` alone (49 §3.2, §8.4 decision 6). Entity migration 137
    // stamps this role onto orgs seeded before it existed.
    code: '1210',
    name: 'Affirm Clearing',
    accountType: GlAccountType.ASSET,
    role: 'clearing_affirm',
  },
  {
    // Money that arrived and auxx cannot attribute. The payout entry's fourth
    // leg: a gateway payout settles charges the merchant took OUTSIDE auxx too,
    // and those were never debited to `1200`. Held as a liability - until it is
    // attributed, "we hold money we cannot explain" is the true statement, and
    // recognising it as revenue would book income on the strength of not
    // knowing what it is.
    code: '2450',
    name: 'Unidentified Receipts',
    accountType: GlAccountType.LIABILITY,
    role: 'unidentified_receipts',
  },
  {
    // What the processor withheld from a payout. The payout entry's expense
    // leg. NOT the Connect application fee in `money/payments/fees.ts`.
    code: '6100',
    name: 'Merchant Fees - Cards',
    accountType: GlAccountType.EXPENSE,
    role: 'payment_processing_fees',
  },
  {
    // Kept separate from 6100 for RECONCILIATION, not optimisation: Affirm
    // settles in its own deposit, so its fees have to be separable to clear
    // 1210 (accrual plan §3).
    code: '6105',
    name: 'Merchant Fees - Affirm',
    accountType: GlAccountType.EXPENSE,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// prepayments: deposits and deferred revenue (16 §1.4)
// ─────────────────────────────────────────────────────────────────────────────
const PREPAYMENTS_ACCOUNTS: readonly DefaultChartAccount[] = [
  {
    code: '2300',
    name: 'Deferred Revenue',
    accountType: GlAccountType.LIABILITY,
    // Month-end only, reversed on day one of the next month.
    role: 'deferred_revenue',
  },
  {
    // Money taken BEFORE delivery - `money/payments/deposit.ts`. A BANK deposit
    // is a different thing entirely and lands on `cash`.
    code: '2350',
    name: 'Customer Deposits',
    accountType: GlAccountType.LIABILITY,
    role: 'customer_deposits',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// inventory: the L1 month-end close (16 §1.4)
// ─────────────────────────────────────────────────────────────────────────────
//
// `month_end_inventory` IS an enabled posting type, but on an org with no parts
// it refuses with "Nothing moved" before any role is resolved (16 §0.2), so
// its seven roles cost a knowledge-base org nothing except seven rows on the
// Roles tab and seven accounts in the chart. That is why they are a pack.
// `5010` and `5030` ride along because they are COGS and the P&L groups them by
// subtype (16 §1.6).
const INVENTORY_ACCOUNTS: readonly DefaultChartAccount[] = [
  // ── Assets ──────────────────────────────────────────────────────────────
  {
    code: '1310',
    name: 'Raw Materials / Parts',
    accountType: GlAccountType.ASSET,
    role: 'inventory_raw_materials',
    subtype: GlAccountSubtype.INVENTORY,
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
    subtype: GlAccountSubtype.INVENTORY,
  },
  {
    code: '1330',
    name: 'Finished Goods',
    accountType: GlAccountType.ASSET,
    role: 'inventory_finished_goods',
    subtype: GlAccountSubtype.INVENTORY,
  },

  // ── Liabilities ─────────────────────────────────────────────────────────
  {
    code: '2110',
    name: 'Payroll Clearing',
    accountType: GlAccountType.LIABILITY,
    role: 'payroll_clearing',
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
    subtype: GlAccountSubtype.COST_OF_GOODS_SOLD,
  },
  {
    code: '5010',
    name: 'COGS - Direct Labor',
    accountType: GlAccountType.EXPENSE,
    subtype: GlAccountSubtype.COST_OF_GOODS_SOLD,
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
    subtype: GlAccountSubtype.COST_OF_GOODS_SOLD,
  },
  {
    code: '5030',
    name: 'COGS - Freight-Out',
    accountType: GlAccountType.EXPENSE,
    subtype: GlAccountSubtype.COST_OF_GOODS_SOLD,
    // Above gross profit, deliberately (accrual plan §4). Distinct from the
    // `freight_accrual` LIABILITY, which is inbound freight capitalised into
    // landed cost. Two different freights; do not point one role at both.
  },
  {
    // 🛑 A SIBLING of 5090, not a merge with it (`G12`). 5090 answers "the
    // vendor billed something other than what we accrued"; this one answers
    // "the shelf disagrees with the ledger". Different owner, different remedy,
    // different trend - one account holding both answers neither, and the L1
    // month-end assertion would absorb count variance into the COGS plug, which
    // is precisely the separation `G12` exists to get.
    //
    // Numbered 5095 so the two read as a pair in a sorted chart.
    code: '5095',
    name: 'Inventory Count Variance',
    accountType: GlAccountType.EXPENSE,
    role: 'inventory_count_variance',
    subtype: GlAccountSubtype.COST_OF_GOODS_SOLD,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// purchasing: purchase orders, receiving and vendor bills (16 §1.4)
// ─────────────────────────────────────────────────────────────────────────────
//
// Requires `inventory`: a receipt debits an inventory role (`build-entry.ts`,
// the receipt builder), so provisioning this pack alone walks `inventory`
// first. `5090` sits HERE and `5095` in `inventory` because `G12` gives them
// different owners and different remedies.
const PURCHASING_ACCOUNTS: readonly DefaultChartAccount[] = [
  // ── Liabilities ─────────────────────────────────────────────────────────
  {
    // BROADER than "carrier freight", deliberately (`G17`). A customs broker's
    // service charge is attributable to a shipment, so it is landed cost and it
    // clears here - NOT through 2170, which is duty owed to the government. The
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

  // ── Cost of goods sold ──────────────────────────────────────────────────
  {
    code: '5090',
    name: 'Inventory / Purchase Price Variance',
    accountType: GlAccountType.EXPENSE,
    role: 'ppv',
    subtype: GlAccountSubtype.COST_OF_GOODS_SOLD,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// payroll: the gross-up entry and what it owes (21 §2, §4.2)
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️ A BOOKKEEPING CONVENTION, not a payroll integration. Nothing in auxx reads
// ADP or Gusto and nothing here should - a person types the figures off the
// payroll provider's own report as a journal entry (21 §2.4). This pack exists
// so those figures have named accounts to land on.
//
// The reconciliation it is shaped for (21 §2.1). The cash leg is already
// correct and already single-writer: the bank feed owns it, and a journal that
// names no bank account cannot double-count it.
//
//   Bank feed, coded:  Dr 2120 Net Pay Clearing            (net cash)
//                          Cr <bank account>               (net cash)
//   Gross-up entry:    Dr 6400 Wages and Salaries          (gross)
//                      Dr 6410 Employer Payroll Taxes
//                          Cr 2130 Payroll Withholdings Payable
//                          Cr 2120 Net Pay Clearing        (net cash)
//
// 2120 nets to zero once both halves are in, and 2130 nets to zero when the
// remittance clears the bank. The account BALANCE is the reconciliation, and
// the trial balance already reports it.
//
// ⚠️ `2100 Accrued Payroll` is deliberately not revived here. It is one of the
// four accounts brief 16 dropped from every pack (see the file header), and
// `default-chart.test.ts` pins its absence; an org that wants a period-end
// payroll accrual adds it in the chart editor.
//
// No role on any of these: no builder emits a payroll entry, so a role would
// name nothing and would have to be added to the closed `ACCOUNT_ROLES`
// vocabulary to compile at all.
const PAYROLL_ACCOUNTS: readonly DefaultChartAccount[] = [
  // ── Liabilities ─────────────────────────────────────────────────────────
  {
    // 🛑 NOT `2110 Payroll Clearing`, which is a different account answering a
    // different question. 2110 is the manufacturing labour absorption pool in
    // the `inventory` pack: `build-month-end-inventory.ts:277` only ever
    // CREDITS it, by the labour absorbed into inventory. This one holds NET PAY
    // between the gross-up entry and the bank line that paid it.
    //
    // Pointing both stories at one balance means neither can be read - the
    // residual would be unabsorbed labour plus unpaid net pay with nothing able
    // to separate them, which is the shape of the defect 21 §0.5 already
    // describes on 2110 alone (21 §2.3, reversible per 21 §7.6).
    code: '2120',
    name: 'Net Pay Clearing',
    accountType: GlAccountType.LIABILITY,
  },
  {
    // Employee withholdings and the employer's own share, from the run until
    // the remittance clears the bank. ONE account, not one per authority: the
    // split lives on the payroll provider's report, and an org that wants
    // federal and state apart adds two of its own.
    code: '2130',
    name: 'Payroll Withholdings Payable',
    accountType: GlAccountType.LIABILITY,
  },

  // ── Operating expenses ──────────────────────────────────────────────────
  {
    // GROSS, not net. The net figure is a cash fact and belongs to 2120.
    code: '6400',
    name: 'Wages and Salaries',
    accountType: GlAccountType.EXPENSE,
  },
  {
    // The EMPLOYER's share only. The employee's share was withheld out of gross
    // pay, so it is already inside 6400; posting it here as well would overstate
    // the cost of employing somebody by the whole withholding.
    code: '6410',
    name: 'Employer Payroll Taxes',
    accountType: GlAccountType.EXPENSE,
  },
  {
    // Health cover, retirement match, the rest. Separate from `6030 Insurance`,
    // which is the company's own general cover and is not a cost of employing
    // anyone.
    code: '6420',
    name: 'Employee Benefits',
    accountType: GlAccountType.EXPENSE,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// fixed_assets: assets at cost, what has depreciated off them, the expense
// ─────────────────────────────────────────────────────────────────────────────
//
// Three accounts and no register (21 DECIDED B, §1.7). Straight-line
// depreciation is `Dr 6500 / Cr 1590`, the same figure every month for a known
// number of months, which is a recurring journal template's exact shape. What a
// register would add is the arithmetic and the year-end schedule a firm asks
// for, and there is no fixed-asset entity anywhere in the repo; until a
// customer asks, a person types the monthly figure the way they already type
// the opening trial balance.
const FIXED_ASSET_ACCOUNTS: readonly DefaultChartAccount[] = [
  // ── Assets ──────────────────────────────────────────────────────────────
  {
    // ONE account at cost, not one per class. A chart that splits vehicles,
    // equipment and leasehold improvements on day one is three rows an org has
    // to route to correctly for a purchase it makes twice a year; an org that
    // needs the split adds it, and 15.2's sort keeps the numbers together.
    code: '1500',
    name: 'Fixed Assets at Cost',
    accountType: GlAccountType.ASSET,
    subtype: GlAccountSubtype.FIXED_ASSET,
  },
  {
    // A contra-asset: an ASSET that runs credit-normal, the same reading `4090`
    // gets as a contra-revenue and `1190` got before it was dropped.
    // `GlAccountType` has no contra classification and does not need one -
    // contra is a presentation attribute, not a posting rule. Numbered 1590 so
    // it sorts directly under the cost account it reduces.
    code: '1590',
    name: 'Accumulated Depreciation',
    accountType: GlAccountType.ASSET,
    subtype: GlAccountSubtype.FIXED_ASSET,
  },

  // ── Operating expenses ──────────────────────────────────────────────────
  {
    // No subtype, deliberately: depreciation is an operating expense, and
    // `profit-and-loss.ts` puts everything that is not `cost_of_goods_sold`
    // below gross profit. A manufacturer that depreciates production equipment
    // into overhead absorbs it through `5020` instead and leaves this alone.
    code: '6500',
    name: 'Depreciation Expense',
    accountType: GlAccountType.EXPENSE,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// debt: money the company borrowed, and what it costs (21 §4.2)
// ─────────────────────────────────────────────────────────────────────────────
//
// A pack rather than core because a company may simply never borrow, and two
// payable accounts it can never use are two rows on a screen for nothing - the
// same test `inventory` and `payroll` pass.
//
// ⚠️ The owner side of "where did the money come from" is NOT here. `3010
// Owner Contributions` and `3020 Owner Draws` are core, because a founder's
// deposit is a first-week bank line for every company and a loan drawdown is
// not. Named `debt` rather than `equity_and_debt` for exactly that reason.
const DEBT_ACCOUNTS: readonly DefaultChartAccount[] = [
  // ── Liabilities ─────────────────────────────────────────────────────────
  {
    // The principal falling due inside twelve months. TWO accounts rather than
    // one because `GlAccountType`'s five-way collapse loses the current /
    // non-current split (see this file's note 2 below), and that split is most
    // of the difference between a balance sheet a lender will read and one it
    // will not. A person moves the current portion at year end with a journal.
    code: '2500',
    name: 'Loans Payable - Current',
    accountType: GlAccountType.LIABILITY,
  },
  {
    // Everything falling due after twelve months. Numbered clear of the 2xxx
    // current block so a sorted chart reads current, then long term.
    code: '2800',
    name: 'Loans Payable - Long Term',
    accountType: GlAccountType.LIABILITY,
  },

  // ── Operating expenses ──────────────────────────────────────────────────
  {
    // Interest only. 🛑 The principal half of a loan payment is a debit to 2500
    // and touches no expense account at all; coding a whole payment here is the
    // error this account's existence has to survive.
    //
    // 21 §4.2 sketched this in the operating list. It rides with the debt it
    // comes from instead, so an org that never borrows does not carry it.
    // `6090 Bank Charges` is what the bank charges for the account itself and
    // is a different thing.
    code: '6600',
    name: 'Interest Expense',
    accountType: GlAccountType.EXPENSE,
  },
]

/**
 * The default chart of accounts, as eight packs.
 *
 * ## What this is, and what it is NOT
 *
 * **It is a DEFAULT, not a standard** (decision `G7`). Charts of accounts are
 * not standardised: US GAAP mandates no numbering at all, QuickBooks' own
 * default chart varies by country and by industry and is routinely edited on
 * day one, and some jurisdictions mandate an entirely different one - France's
 * PCG, Germany's SKR03/04. So auxx seeds this, and a person changes it: renames
 * an account, renumbers one, deactivates one at year end, adds twenty of their
 * own. A pack is still data a person edits afterwards.
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
 * table does not list them. Three equity accounts (`3000`, `3100`, `3900`) were
 * added 2026-09-04 once the opening trial balance and the balance sheet needed
 * somewhere to land (plans/accounting/HANDOFF.md decision 6.4), with `1050`,
 * `4020` and `6300` in the same pass.
 *
 * Brief 21 §4.2 closed the largest remaining gap in that presumption: the
 * ordinary operating expenses, `1400 Prepaid Expenses` and the two owner-equity
 * movement accounts are now core, and `payroll`, `fixed_assets` and `debt` are
 * packs. It is still not a complete chart - there is no credit-card liability,
 * no per-class asset breakdown and no jurisdiction split on withholdings -
 * because each of those is an account a person adds once, in the editor, when
 * they know the answer.
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
 *    Other Current Liability -> `liability`. The collapse loses the
 *    current/non-current split and any contra marking; that is a presentation
 *    concern for the provider's own chart, not something a posting reads.
 *
 * @see ACCOUNT_ROLES in `build-entry.ts` for what each role means
 * @see plans/money/accrual-accounting-plan.html §2 for the accounting argument
 * @see plans/accounting/tasks/16-the-chart-of-accounts.md §1 for the packs
 */
export const CHART_PACKS: Record<ChartPackKey, ChartPack> = {
  core: {
    key: 'core',
    label: 'Core',
    description:
      'Receivables, payables, sales tax, equity, revenue and bad debt. Every organization gets these.',
    accounts: CORE_ACCOUNTS,
  },
  card_rail: {
    key: 'card_rail',
    label: 'Card payments and payouts',
    description:
      'Clearing and fee accounts for Stripe Connect, Shopify Payments and Affirm settlements.',
    accounts: CARD_RAIL_ACCOUNTS,
  },
  prepayments: {
    key: 'prepayments',
    label: 'Deposits and deferred revenue',
    description: 'Customer deposits taken before delivery, and revenue deferred at month end.',
    accounts: PREPAYMENTS_ACCOUNTS,
  },
  inventory: {
    key: 'inventory',
    label: 'Inventory and manufacturing',
    description:
      'Raw materials, work in process, finished goods, payroll clearing and cost of goods sold.',
    accounts: INVENTORY_ACCOUNTS,
  },
  purchasing: {
    key: 'purchasing',
    label: 'Purchase orders, receiving and vendor bills',
    description:
      'Goods received not invoiced, inbound freight and duties accruals, and purchase price variance.',
    requires: ['inventory'],
    accounts: PURCHASING_ACCOUNTS,
  },
  payroll: {
    key: 'payroll',
    label: 'Payroll',
    description:
      'Wages, employer taxes and benefits, with the withholding and net-pay accounts a payroll run clears through.',
    accounts: PAYROLL_ACCOUNTS,
  },
  fixed_assets: {
    key: 'fixed_assets',
    label: 'Fixed assets and depreciation',
    description:
      'Assets held at cost, the depreciation taken off them, and the monthly depreciation expense.',
    accounts: FIXED_ASSET_ACCOUNTS,
  },
  debt: {
    key: 'debt',
    label: 'Loans and interest',
    description: 'Loans payable, split current and long term, and the interest they cost.',
    accounts: DEBT_ACCOUNTS,
  },
}

/**
 * Every pack key in declaration order, `core` first. A tuple rather than
 * `Object.keys(CHART_PACKS)` so a `z.enum` can be built from it.
 */
export const CHART_PACK_KEYS = [
  'core',
  'card_rail',
  'prepayments',
  'inventory',
  'purchasing',
  'payroll',
  'fixed_assets',
  'debt',
] as const satisfies readonly ChartPackKey[]

/**
 * Every pack flattened, in pack order. What the union tests and the old
 * importers read; the seeder walks packs instead (16 §1.5).
 */
export const DEFAULT_CHART_OF_ACCOUNTS: readonly DefaultChartAccount[] = CHART_PACK_KEYS.flatMap(
  (key) => CHART_PACKS[key].accounts
)

/** `role -> pack`, built once from the tables. The union test proves it total. */
const PACK_BY_ROLE = Object.fromEntries(
  CHART_PACK_KEYS.flatMap((key) =>
    CHART_PACKS[key].accounts.flatMap((account) => (account.role ? [[account.role, key]] : []))
  )
) as Record<AccountRole, ChartPackKey>

/** The pack whose accounts carry this role. Every role is in exactly one. */
export function packForRole(role: AccountRole): ChartPackKey {
  return PACK_BY_ROLE[role]
}

/**
 * A pack is provisioned when none of its roles is `unmapped`.
 *
 * Derived on the client from `ledger.roleMap` and `CHART_PACKS`; no new query.
 * `unused` and `suggested` both count as present: a person has looked at the
 * role, which is the thing an absent row says nobody has. A role missing from
 * `roleMap` altogether is read as `unmapped`, though `listRoleMap` returns
 * every role.
 *
 * 🛑 **A pack with NO roles always reads `absent`, and that is a deliberate
 * lie in the safe direction.** `payroll`, `fixed_assets` and `debt` (21 §4.2)
 * carry no role at all - no builder emits rent, wages, depreciation or
 * interest - so the role map cannot see whether their accounts exist, and the
 * empty filter below would otherwise report `provisioned`. That answer is the
 * expensive one: `chart-packs-dialog.tsx` disables a `provisioned` row, so a
 * pack nobody had ever added could never be added. `absent` costs at worst one
 * re-walk of an idempotent seed. Answering it properly means asking the CHART
 * for the codes rather than the role map for the roles, which is a query the
 * dialog does not make today.
 */
export function packState(
  pack: ChartPackKey,
  roleMap: readonly Pick<RoleAssignmentRow, 'role' | 'state'>[]
): 'provisioned' | 'partial' | 'absent' {
  const roles = CHART_PACKS[pack].accounts.flatMap((account) =>
    account.role ? [account.role] : []
  )
  if (roles.length === 0) return 'absent'
  const stateByRole = new Map(roleMap.map((row) => [row.role, row.state]))
  const unmapped = roles.filter((role) => (stateByRole.get(role) ?? 'unmapped') === 'unmapped')
  if (unmapped.length === 0) return 'provisioned'
  if (unmapped.length === roles.length) return 'absent'
  return 'partial'
}
