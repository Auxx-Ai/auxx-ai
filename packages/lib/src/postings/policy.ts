// packages/lib/src/postings/policy.ts
//
// PURE, client-safe. One declared record per posting type: what triggers it,
// what its entry looks like as roles, which settings change it, the sentence
// for its ON state and its OFF state, and the constants a person should know
// about. plans/accounting/tasks/done/28-how-your-books-post.md section 2.
//
// Four tables used to answer four separate questions about a posting type
// (`ENABLED_POSTING_TYPES`, `EXPORT_ROUTE_BY_POSTING_TYPE`,
// `SINGLE_WRITER_ROLES_BY_POSTING_TYPE` in `regime.ts`, and the disabled-state
// sentences in `reports/completeness.ts`). They are now fields on this record,
// and those four names are DERIVED VIEWS of it, so a call site reads exactly
// what it read before and a person edits one file.
//
// ── Declared, never derived ────────────────────────────────────────────────
//
// Nothing in this file is computed from a builder, a worker schedule or a
// settings catalog. A person comes here and says what the trigger is, what the
// entry looks like and which setting changes it. If the code and this
// declaration disagree, the declaration is the bug report: a table derived from
// the builders would simply move with them and tell nobody. `regime.ts`'s header
// says the same about the single-writer table, and this file inherits the rule
// for every field.
//
// The trigger facts were verified against the code on 2026-09-14; each entry
// names the file it was read from so the next reader can check the same line.
//
// ── Order matters ──────────────────────────────────────────────────────────
//
// `ENABLED_POSTING_TYPES` is derived in DECLARATION order, and
// `__tests__/policy.test.ts` pins that derived list byte for byte (the wave
// order the ledger was switched on in, then `recurring_journal`, enabled on
// 2026-09-14 by brief 28 decision 5). Add a new enabled type at the end of the
// enabled block and extend the pin; the disabled and never-posting types
// follow it.
//
// ── What the page and the guide read that is not prose ─────────────────────
//
// `records` names the record pages a type reads its `'by id'` accounts from
// (payment gateways, bank accounts, recurring templates) and `settingCopy` is
// the row title and page sentence a setting key gets on the Posting page.
// Both used to be tables in the web app's `posting-page-model.ts`; brief 28
// decision 7 moved them here so the page and the guide shrink to rendering and
// a new setting or record reaches both by being declared on the policy.

import { ACCOUNT_ROLES, type AccountRole } from './build-entry'
import type { PostingType } from './types'

/**
 * `journal`  auxx composes the entry and pushes it to the connected system.
 * `none`     nothing is exported for this type at all.
 *
 * DECLARED per type on {@link POSTING_POLICY}, never derived from "does a
 * mirror exist for this type". Deriving it would mean that adding a document
 * mirror silently switched a posting type's route, which is the change most
 * likely to double-book, and the check that should have caught it would move
 * with it. `opening_balance` and `provider_sync` are the two `none` routes, and
 * both for the same class of reason: an entry that CAME FROM the provider must
 * never be pushed back at it (brief 19 section 5.1, brief 20 section 6).
 */
export type ExportRoute = 'journal' | 'none'

/** How a posting type reaches the ledger. `never` is a real, declared answer. */
export type PostingTrigger =
  | { kind: 'event'; on: string }
  | { kind: 'schedule'; cron: string; tz: 'UTC'; description: string }
  | { kind: 'console'; where: string }
  | { kind: 'inbound'; from: string }
  | { kind: 'never' }

/**
 * One line of a type's entry, as a ROLE, before the org's role map resolves
 * it. `'by id'` is a line that names a `gl_account` id directly (a bank
 * account, a gateway record's clearing account, a bookkeeper's chosen account)
 * and so has no role for the map to resolve.
 */
export interface PostingTemplateLine {
  side: 'debit' | 'credit'
  role: AccountRole | 'by id'
  what: string
}

/** A declared constant a person should know about (brief 28 section 7). */
export interface PostingParameter {
  name: string
  value: string
  sentence: string
}

/**
 * A record page a type reads accounts from, as opposed to a setting. The
 * template names those accounts as `'by id'` lines; this says which screen
 * holds the record. Nothing moves off those screens; the Posting page links.
 */
export interface PostingRecordLink {
  label: string
  /** An in-app path, always under `/app/`. */
  href: string
}

/**
 * The row title (and, where the catalog's description is written for a
 * different screen, the description) a setting key gets on the Posting page
 * and in the guide. A key with no copy renders with a humanised title and the
 * catalog description.
 */
export interface PostingSettingCopy {
  title: string
  description?: string
}

export interface PostingPolicy {
  type: PostingType
  label: string
  /** How this type reaches the ledger. `never` is a real, declared answer. */
  trigger: PostingTrigger
  /** The entry as roles, before the org's role map resolves them. Empty for a `never` type. */
  template: readonly PostingTemplateLine[]
  /**
   * Every org setting key that changes THIS type's behaviour. The three keys
   * every type shares ({@link LEDGER_WIDE_SETTING_KEYS}) are not repeated here.
   */
  settings: readonly string[]
  /** One sentence for the ON state, the pair of {@link PostingPolicy.disabledSentence}. */
  sentence: string
  /**
   * One sentence for the OFF state, naming what a statement consequently lacks.
   * Rendered by the completeness banner for every type not `enabled`.
   */
  disabledSentence: string
  /** The declared constants a person should know about (brief 28 section 7). */
  parameters: readonly PostingParameter[]
  /** The record pages this type reads its `'by id'` accounts from. Absent when it reads none. */
  records?: readonly PostingRecordLink[]
  /**
   * Row title and page copy per setting key, for keys in {@link settings}.
   * `__tests__/policy.test.ts` refuses a key here that the policy does not list.
   */
  settingCopy?: Readonly<Record<string, PostingSettingCopy>>
  /**
   * Whether a production ledger emits this type today. `ENABLED_POSTING_TYPES`
   * in `regime.ts` is this flag, in declaration order.
   *
   * Turning L3 on is ONE change, never two: `receipt` and `vendor_bill` flip on
   * in the same edit that flips `month_end_inventory` off, or the ledger runs
   * two regimes at once (see `regime.ts`'s header).
   */
  enabled: boolean
  /** How this type reaches the connected accounting system. */
  exportRoute: ExportRoute
  /**
   * Which single-writer (inventory) roles this type may put on a line.
   * `SINGLE_WRITER_ROLES_BY_POSTING_TYPE` in `regime.ts` is this field.
   */
  singleWriterRoles: readonly AccountRole[]
}

/**
 * The three settings that govern EVERY posting type: which months are closed
 * to the previous system, where a day boundary falls, and which months are
 * locked. Declared once rather than repeated on each policy, so the Posting
 * page renders them once.
 */
export const LEDGER_WIDE_SETTING_KEYS: readonly string[] = [
  'accounting.cutoffPeriod',
  'accounting.bookTimeZone',
  'ledger.lockedThroughMonth',
]

const INVENTORY_ROLES: readonly AccountRole[] = [
  ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
  ACCOUNT_ROLES.INVENTORY_WIP,
  ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
]

// The record pages more than one type reads, declared once.
const PAYMENT_GATEWAYS_RECORD: PostingRecordLink = {
  label: 'Payment gateways',
  href: '/app/accounting/settings/payment-gateways',
}
const BANK_ACCOUNTS_RECORD: PostingRecordLink = {
  label: 'Bank accounts',
  href: '/app/accounting/settings/bank-accounts',
}

/**
 * The declared posting policy, one record per posting type.
 *
 * Pinned to `POSTING_TYPES` by exact-set equality in `__tests__/policy.test.ts`:
 * a new posting type without a policy is a red test, not a missing row.
 */
export const POSTING_POLICY: Record<PostingType, PostingPolicy> = {
  // ── Enabled, in the order the ledger switched them on ───────────────────

  month_end_inventory: {
    type: 'month_end_inventory',
    label: 'Month-end inventory',
    // postings/close-month.ts `postMonthEnd`, reached from the close console.
    trigger: { kind: 'console', where: 'The close console on the ledger, one month at a time' },
    template: [
      {
        side: 'debit',
        role: ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
        what: 'Moved to the balance the movement ledger computes; the side follows the delta',
      },
      {
        side: 'debit',
        role: ACCOUNT_ROLES.INVENTORY_WIP,
        what: 'Moved to the computed balance; the side follows the delta',
      },
      {
        side: 'debit',
        role: ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
        what: 'Moved to the computed balance; the side follows the delta',
      },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.PAYROLL_CLEARING,
        what: 'Labour absorbed into builds this month',
      },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.APPLIED_OVERHEAD,
        what: 'Overhead absorbed into builds this month',
      },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.INVENTORY_COUNT_VARIANCE,
        what: 'Count adjustments and shrinkage; the side follows the sign',
      },
      {
        side: 'debit',
        role: ACCOUNT_ROLES.COGS_PRODUCT_COST,
        what: 'The balancing line: what left inventory as cost of goods sold',
      },
    ],
    settings: [
      'accounting.openingRawMaterials',
      'accounting.openingWip',
      'accounting.openingFinishedGoods',
    ],
    sentence:
      'Once a month the close asserts the three inventory accounts to what the movement ledger says they hold, and the difference is cost of goods sold.',
    disabledSentence:
      'Month-end inventory posting is off, so the inventory accounts and cost of goods sold are never brought to the ledger.',
    parameters: [
      {
        name: 'Method',
        value: 'Monthly assertion',
        sentence:
          'Inventory is asserted once a month rather than posted per receipt or build; the two cannot both be on, so receipts, builds and vendor bills post nothing.',
      },
      {
        name: 'Opening baseline',
        value: 'The three opening inventory settings',
        sentence:
          'The first close computes its delta from the opening balances entered in setup, not from the opening entry.',
      },
    ],
    records: [{ label: 'The ledger', href: '/app/accounting' }],
    enabled: true,
    exportRoute: 'journal',
    singleWriterRoles: INVENTORY_ROLES,
  },

  manual_journal: {
    type: 'manual_journal',
    label: 'Manual journal',
    // postings/journal-entries/writes.ts `postJournalEntry`.
    trigger: { kind: 'console', where: 'Post on a journal entry under Journal entries' },
    template: [
      { side: 'debit', role: 'by id', what: 'Each line, the account the bookkeeper chose' },
      { side: 'credit', role: 'by id', what: 'Each line, the account the bookkeeper chose' },
    ],
    settings: [],
    sentence:
      'A bookkeeper posts an adjusting entry, line by line, against the chart as it is now.',
    disabledSentence:
      'Manual journal entries are off, so a bookkeeper cannot post an adjusting entry.',
    parameters: [
      {
        name: 'Inventory accounts refused',
        value: 'Raw materials, WIP, finished goods',
        sentence:
          'A hand-keyed line on an inventory account is refused, because the month-end assertion would reverse it at the next close.',
      },
    ],
    records: [{ label: 'Journal entries', href: '/app/accounting' }],
    enabled: true,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  opening_balance: {
    type: 'opening_balance',
    label: 'Opening balance',
    // postings/opening-trial-balance/writes.ts `postOpeningTrialBalance`.
    trigger: { kind: 'console', where: 'Post on the opening trial balance in accounting setup' },
    template: [
      { side: 'debit', role: 'by id', what: 'Each account with a balance on the cutover date' },
      { side: 'credit', role: 'by id', what: 'Each account with a balance on the cutover date' },
    ],
    // The two keys that DATE this entry, not merely gate it: it is posted the
    // day before the first month after the cutoff, in the book time zone.
    settings: ['accounting.cutoffPeriod', 'accounting.bookTimeZone'],
    sentence:
      'Posted once, dated the day before the first month auxx keeps, so the ledger starts from where the previous system left off.',
    disabledSentence: 'The opening trial balance is off, so this ledger has no starting position.',
    parameters: [
      {
        name: 'Never exported',
        value: 'Export route: none',
        sentence:
          'The connected system already holds these balances, or is where they came from, so this entry is never pushed back at it.',
      },
    ],
    records: [{ label: 'Opening balances', href: '/app/accounting/settings/opening' }],
    enabled: true,
    exportRoute: 'none',
    singleWriterRoles: [],
  },

  bank_deposit: {
    type: 'bank_deposit',
    label: 'Bank deposit',
    // money/bank-deposits/writes.ts `postEntry` call, when a run is grouped.
    trigger: { kind: 'event', on: 'A deposit run is grouped under Bank deposits' },
    template: [
      { side: 'debit', role: 'by id', what: "The chosen bank account's own GL account" },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.UNDEPOSITED_FUNDS,
        what: 'Every payment in the run, as one line',
      },
    ],
    settings: [],
    sentence:
      'Grouping cash and cheques into a deposit run moves them from undeposited funds into the bank account they were banked into, as one line the bank feed can match.',
    disabledSentence: 'Deposit posting is off, so undeposited funds is never cleared to cash.',
    parameters: [],
    records: [BANK_ACCOUNTS_RECORD],
    enabled: true,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  fulfillment: {
    type: 'fulfillment',
    label: 'Fulfillment',
    // money/orders/fulfill.ts, on every shipment.
    trigger: { kind: 'event', on: 'A fulfillment ships' },
    template: [
      {
        side: 'debit',
        role: ACCOUNT_ROLES.CLEARING,
        what: 'Card shipments, summarised, when no gateway record claims the rail',
      },
      {
        side: 'debit',
        role: 'by id',
        what: "A payment gateway record's own clearing account, summarised per record",
      },
      {
        side: 'debit',
        role: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
        what: 'One line per order on terms, unpaid, or paid manually',
      },
      { side: 'credit', role: ACCOUNT_ROLES.REVENUE_PRODUCT, what: 'Product revenue, summarised' },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.REVENUE_SHIPPING,
        what: 'Shipping charged, summarised',
      },
      { side: 'credit', role: ACCOUNT_ROLES.SALES_TAX_PAYABLE, what: 'Tax collected, summarised' },
    ],
    settings: ['accounting.autoPost.fulfillment'],
    sentence:
      "One entry per shipment recognises revenue, shipping and tax the moment it ships, debited to the order's payment rail's clearing account or to receivables on terms.",
    disabledSentence:
      'Fulfillment posting is off, so revenue and COGS come only from the monthly inventory assertion.',
    parameters: [
      {
        name: 'Recognition date',
        value: 'The ship date',
        sentence:
          'Revenue is recognised on the day the goods left, never on the order date or the day the entry was posted; changing this is a different accounting method, so it is not a setting.',
      },
      {
        name: 'Debit fork',
        value: 'Receivables, a gateway record, or card clearing',
        sentence:
          'An order that is not paid, or paid manually, debits receivables; a paid order debits the clearing account of the gateway record that claims its rail, or card clearing when none does.',
      },
      {
        name: 'Excluded orders',
        value: 'Test gateway, or two gateways on one order',
        sentence:
          'A test order posts nothing, and an order paid through two gateways is excluded with the reason recorded, because no single line can describe the split.',
      },
      {
        name: 'Cost of goods sold',
        value: 'Not posted per shipment',
        sentence:
          'The cost side of a shipment stays with the monthly inventory assertion; this entry carries revenue only.',
      },
    ],
    records: [PAYMENT_GATEWAYS_RECORD],
    settingCopy: {
      'accounting.autoPost.fulfillment': {
        title: 'Auto-post fulfillments',
        description:
          'On, a shipment posts immediately. Off, it drafts on the ledger for review and approval.',
      },
    },
    enabled: true,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  payment: {
    type: 'payment',
    label: 'Payment',
    // money/invoices/receipt-accounting.ts and money/customer-money/accounting.ts
    // on a receipt; money/customer-money/refund-accounting.ts on a refund.
    trigger: { kind: 'event', on: 'A customer receipt or refund is recorded' },
    template: [
      {
        side: 'debit',
        role: ACCOUNT_ROLES.UNDEPOSITED_FUNDS,
        what: 'Cash, cheques and unknown methods, until a deposit run banks them',
      },
      { side: 'debit', role: ACCOUNT_ROLES.CLEARING, what: 'Card payments, until the payout' },
      { side: 'debit', role: 'by id', what: 'The cash bank account, for ACH and wire' },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
        what: 'The invoice the payment settles',
      },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.CUSTOMER_DEPOSITS,
        what: 'Any amount not yet applied to an invoice, held as a deposit',
      },
    ],
    settings: [
      'accounting.paymentRoute.cash',
      'accounting.paymentRoute.check',
      'accounting.paymentRoute.card',
      'accounting.paymentRoute.bank',
      'accounting.paymentRoute.other',
      'accounting.cashBankAccountId',
      'accounting.autoPost.receipt',
      'accounting.autoPost.refund',
    ],
    sentence:
      'Every payment posts as it arrives, landing where its method says: undeposited funds, card clearing, or straight into the cash bank account.',
    disabledSentence:
      'Payment posting is off, so receivables are never relieved and no money reaches clearing or the bank.',
    parameters: [
      {
        name: 'Routes',
        value: 'One per method',
        sentence:
          'Where a payment lands is a property of its method, declared once per method, so a cheque groups through undeposited funds and a card settles through clearing.',
      },
      {
        name: 'Refund',
        value: 'The same entry, sides swapped',
        sentence: 'A refund is a payment with the sides reversed, through the same route.',
      },
    ],
    records: [BANK_ACCOUNTS_RECORD],
    settingCopy: {
      'accounting.paymentRoute.cash': {
        title: 'Cash',
        description: 'Banked in a run, so it waits to be grouped.',
      },
      'accounting.paymentRoute.check': {
        title: 'Check',
        description: 'Five cheques banked together are one bank line.',
      },
      'accounting.paymentRoute.card': {
        title: 'Card',
        description: 'Settles as a net payout, so it clears rather than banks.',
      },
      'accounting.paymentRoute.bank': {
        title: 'Bank transfer',
        description: 'ACH or wire, arrives on its own line.',
      },
      'accounting.paymentRoute.other': {
        title: 'Other',
        description: 'The unknown rail. Undeposited funds is the safe unknown.',
      },
      'accounting.cashBankAccountId': {
        title: 'Cash bank account',
        description:
          'Where a payment routed to cash is banked. A cash-routed payment refuses to post until this is set.',
      },
      'accounting.autoPost.receipt': {
        title: 'Auto-post receipts',
        description:
          'On, a customer receipt posts immediately. Off, it drafts on the ledger for review and approval.',
      },
      'accounting.autoPost.refund': {
        title: 'Auto-post refunds',
        description:
          'On, a refund posts immediately. Off, it drafts on the ledger for review and approval.',
      },
    },
    enabled: true,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  refund: {
    type: 'refund',
    label: 'Refund',
    // money/customer-money/refund-accounting.ts, on a customer refund.
    trigger: { kind: 'event', on: 'A customer refund is recorded' },
    template: [
      {
        side: 'debit',
        role: ACCOUNT_ROLES.REVENUE_RETURNS_ALLOWANCES,
        what: 'What the customer is being given back',
      },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.CLEARING,
        what: 'Card refunds, until the payout nets them',
      },
      { side: 'credit', role: 'by id', what: 'The cash bank account, for ACH and wire' },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.UNDEPOSITED_FUNDS,
        what: 'Cash, cheques and unknown methods',
      },
    ],
    settings: [
      'accounting.paymentRoute.cash',
      'accounting.paymentRoute.check',
      'accounting.paymentRoute.card',
      'accounting.paymentRoute.bank',
      'accounting.paymentRoute.other',
      'accounting.cashBankAccountId',
      'accounting.autoPost.refund',
    ],
    sentence:
      'A refund posts as it is issued, leaving by the same route the money arrived on: card clearing, the cash bank account, or undeposited funds.',
    disabledSentence:
      'Refund posting is off, so money given back to a customer never leaves the books and returns are never recognised.',
    parameters: [
      {
        name: 'Route',
        value: 'The method it left by',
        sentence:
          'A refund reads the same per-method route a receipt does, so the two sides of one card sale clear through the same account.',
      },
    ],
    records: [BANK_ACCOUNTS_RECORD],
    settingCopy: {
      'accounting.autoPost.refund': {
        title: 'Auto-post refunds',
        description:
          'On, a refund posts immediately. Off, it drafts on the ledger for review and approval.',
      },
    },
    enabled: true,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  payout: {
    type: 'payout',
    label: 'Payout',
    // apps/worker/src/workers/index.ts `payoutSyncJob`, `30 4 * * *` UTC, running
    // money/payouts/sync.ts `syncPayouts` per connected Stripe account.
    trigger: {
      kind: 'schedule',
      cron: '30 4 * * *',
      tz: 'UTC',
      description: 'Daily at 04:30 UTC, for every organisation with a Stripe Connect account',
    },
    template: [
      {
        side: 'debit',
        role: ACCOUNT_ROLES.BANK,
        what: "The rail's mapped receiving bank account",
      },
      {
        side: 'debit',
        role: ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES,
        what: "Processor fees deducted, or the rail's own fee account",
      },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.CLEARING,
        what: "Gross settled, or the rail's own clearing account",
      },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.UNIDENTIFIED_RECEIPTS,
        what: 'Settled charges auxx holds no payment for, when there are any',
      },
    ],
    settings: [],
    sentence:
      "Each payout drains the rail's clearing account into the bank account it settled into, with the processor's fees recognised alongside.",
    disabledSentence:
      'Payout posting is off, so Shopify and processor clearing accounts are not reconciled per payout.',
    parameters: [
      {
        name: 'Lookback',
        value: '30 days',
        sentence:
          'An ordinary run reads the last 30 days of payouts, so a worker that missed a few days catches up; posting is idempotent on the payout id, so nothing posts twice.',
      },
      {
        name: 'First run',
        value: 'Nothing older than itself',
        sentence:
          'The first run reads from now, not 30 days back: payouts before it left a clearing balance the opening trial balance already carries, and posting them would relieve clearing twice.',
      },
      {
        name: 'Fast door',
        value: 'Stripe payout.paid webhook',
        sentence:
          'A payout.paid event posts the same payout the moment it arrives; the daily run is the guarantee behind it for a webhook that was dropped or unsubscribed.',
      },
    ],
    records: [PAYMENT_GATEWAYS_RECORD, BANK_ACCOUNTS_RECORD],
    enabled: true,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  write_off: {
    type: 'write_off',
    label: 'Write-off',
    // money/invoices/write-off.ts `postEntry` call, on the invoice action.
    trigger: { kind: 'event', on: 'Write off on an invoice' },
    template: [
      {
        side: 'debit',
        role: ACCOUNT_ROLES.BAD_DEBT_EXPENSE,
        what: 'The amount given up, or another expense account chosen by id',
      },
      { side: 'credit', role: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE, what: 'The invoice balance' },
    ],
    settings: [],
    sentence:
      'Writing off an invoice moves what will not be collected out of receivables and into bad debt.',
    disabledSentence: 'Write-off posting is off.',
    parameters: [],
    enabled: true,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  bank_transaction: {
    type: 'bank_transaction',
    label: 'Bank feed',
    // banking/review/writes.ts: a coded line and a transfer post; a matched line does not.
    trigger: { kind: 'event', on: 'A reviewer codes a bank line, or files it as a transfer' },
    template: [
      {
        side: 'debit',
        role: 'by id',
        what: 'The account the reviewer coded, or the receiving bank account',
      },
      {
        side: 'credit',
        role: 'by id',
        what: "The bank account's own GL account, or the sending one",
      },
    ],
    settings: [],
    sentence:
      'A bank line a reviewer codes posts against the account they chose; a line matched to a document posts nothing, because the document already did.',
    disabledSentence: 'Bank feed posting is off, so no bank line has been coded to the books.',
    parameters: [
      {
        name: 'Matched lines',
        value: 'Post nothing',
        sentence:
          'Matching a bank line to a payment or deposit records the match and writes no entry; the money was booked when the document posted.',
      },
      {
        name: 'Candidate window',
        value: '3 days either side',
        sentence:
          'A document may sit up to three days either side of the bank line to be offered as a match: a cheque banked Friday clears Monday, and wider than a week a monthly rent matches the previous month.',
      },
      {
        name: 'Amount tolerance',
        value: '1 percent',
        sentence:
          'A candidate within one percent of the bank line is offered, enough for a wire fee deducted in transit and not enough for two invoices to the same vendor to both look right.',
      },
    ],
    records: [BANK_ACCOUNTS_RECORD],
    enabled: true,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  invoice_issued: {
    type: 'invoice_issued',
    label: 'Invoice issued',
    // money/invoices/issuance-accounting.ts, on Send.
    trigger: { kind: 'event', on: 'Send on an invoice' },
    template: [
      { side: 'debit', role: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE, what: 'The invoice total' },
      { side: 'credit', role: ACCOUNT_ROLES.REVENUE_SERVICE, what: 'The subtotal' },
      { side: 'credit', role: ACCOUNT_ROLES.SALES_TAX_PAYABLE, what: 'Tax on the invoice' },
    ],
    settings: ['accounting.autoPost.invoice'],
    sentence:
      'Sending an invoice raises the receivable every payment entry relieves, dated the day the invoice was issued.',
    disabledSentence:
      'Invoice posting is off, so a sent invoice raises no receivable and its revenue is never recognised.',
    parameters: [],
    settingCopy: {
      'accounting.autoPost.invoice': {
        title: 'Auto-post invoices',
        description:
          'On, an invoice posts immediately at send. Off, it drafts on the ledger for review and approval.',
      },
    },
    enabled: true,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  deposit_application: {
    type: 'deposit_application',
    label: 'Deposit application',
    // money/payments/post-deposit-application.ts `postEntry` call.
    trigger: { kind: 'event', on: 'A held customer deposit is applied to an invoice' },
    template: [
      { side: 'debit', role: ACCOUNT_ROLES.CUSTOMER_DEPOSITS, what: 'The prepayment released' },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
        what: 'The invoice it now settles',
      },
    ],
    settings: [],
    sentence:
      'Applying a prepayment to an invoice reclasses it out of customer deposits and onto that receivable; no money moves.',
    disabledSentence:
      'Deposit application posting is off, so a prepayment applied to an invoice stays a liability and the receivable stays open.',
    parameters: [],
    enabled: true,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  credit_memo: {
    type: 'credit_memo',
    label: 'Credit memo',
    // money/credit-memos/accounting.ts, on issue.
    trigger: { kind: 'event', on: 'Issue on a credit memo' },
    template: [
      {
        side: 'debit',
        role: ACCOUNT_ROLES.REVENUE_RETURNS_ALLOWANCES,
        what: 'Revenue given back',
      },
      { side: 'debit', role: ACCOUNT_ROLES.SALES_TAX_PAYABLE, what: 'Tax given back' },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
        what: 'The customer owes that much less',
      },
      {
        side: 'debit',
        role: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
        what: 'When the channel already refunded the money, the receivable is closed again',
      },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.CLEARING,
        what: "The refund leaving through the rail's clearing account, or its record's account by id",
      },
    ],
    settings: ['accounting.autoPost.creditMemo'],
    sentence:
      'A credit memo reverses revenue and tax against the receivable the moment it is issued; when the channel already refunded the money, the same entry drains it through clearing.',
    disabledSentence:
      'Credit memo posting is off, so a refund or allowance never reduces revenue or the receivable.',
    parameters: [
      {
        name: 'Returned goods',
        value: 'Recorded, not restocked',
        sentence:
          'A returned line is recorded on the memo and never moves inventory; stock is asserted monthly.',
      },
    ],
    records: [PAYMENT_GATEWAYS_RECORD],
    settingCopy: {
      'accounting.autoPost.creditMemo': {
        title: 'Auto-post credit memos',
        description:
          'On, a credit memo posts immediately at issue. Off, it drafts on the ledger for review and approval.',
      },
    },
    enabled: true,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  expense_bill: {
    type: 'expense_bill',
    label: 'Expense bill',
    // purchasing/expense-bill/writes.ts `postEntry` call, on Post.
    trigger: { kind: 'event', on: 'Post on a vendor bill coded to expense accounts' },
    template: [
      {
        side: 'debit',
        role: 'by id',
        what: 'Each line, the expense account the bill was coded to',
      },
      { side: 'credit', role: ACCOUNT_ROLES.ACCOUNTS_PAYABLE, what: 'What the vendor is owed' },
    ],
    settings: ['accounting.autoPost.expenseBill'],
    sentence:
      'Posting a bill for rent, insurance or a subscription raises the payable and puts the expense on the profit and loss, dated the bill.',
    disabledSentence:
      'Expense bill posting is off, so a vendor bill for rent, insurance or a subscription raises ' +
      'no payable and its expense never reaches the profit and loss.',
    parameters: [
      {
        name: 'Totals',
        value: "The vendor's, transcribed",
        sentence:
          "The bill's totals are copied from the vendor's document, never recomputed, so the payable is what the vendor will collect.",
      },
    ],
    settingCopy: {
      'accounting.autoPost.expenseBill': {
        title: 'Auto-post expense bills',
        description:
          'On, an expense bill posts immediately. Off, it drafts on the ledger for review and approval.',
      },
    },
    enabled: true,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  recurring_journal: {
    type: 'recurring_journal',
    label: 'Recurring journal',
    // apps/worker/src/workers/index.ts `recurringJournalsJob`, `45 3 * * *` UTC,
    // running postings/recurring-journals/sweep.ts. Drafts only; a person posts
    // each draft through `postJournalEntry`, which keys it on the occurrence.
    trigger: {
      kind: 'schedule',
      cron: '45 3 * * *',
      tz: 'UTC',
      description:
        'Daily at 03:45 UTC the templates are copied into draft entries; a person posts each draft',
    },
    template: [
      { side: 'debit', role: 'by id', what: 'Each template line, the account it names' },
      { side: 'credit', role: 'by id', what: 'Each template line, the account it names' },
    ],
    settings: [],
    sentence:
      'Depreciation, accruals and prepaid amortisation arrive as drafts on their schedule and post when a person approves each one.',
    disabledSentence:
      'Recurring journal posting is off, so depreciation, accruals and amortisation templates never reach the books.',
    parameters: [
      {
        name: 'Drafts only',
        value: 'Nothing posts unattended',
        sentence: 'The schedule writes drafts; posting one is always a person on Journal entries.',
      },
      {
        name: 'Closed month',
        value: 'Held, never skipped',
        sentence:
          'A template whose next occurrence falls in a closed month is reported and its cursor held, so the entry stays owed rather than silently lost.',
      },
    ],
    records: [{ label: 'Recurring templates', href: '/app/accounting/settings/recurring' }],
    // Enabled 2026-09-14 (brief 28 §10 decision 5). `regime.ts` never listed it
    // while the daily job wrote it, so the completeness banner called a type
    // that posted every day "off". Last in the block because it was switched
    // on last; the pin in `__tests__/policy.test.ts` ends on it.
    enabled: true,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  // ── Written by the sync, and not by a close ─────────────────────────────

  provider_sync: {
    type: 'provider_sync',
    label: 'Connected system',
    // apps/web `ledger.syncProviderLedger` runs postings/provider-sync/sync.ts;
    // the entries themselves are authored in the provider on the accountant's
    // own schedule.
    trigger: {
      kind: 'inbound',
      from: 'Entries the accountant authors in the connected system, read in when Sync is run on the ledger',
    },
    template: [
      {
        side: 'debit',
        role: 'by id',
        what: "Each line, the account the accountant's account maps to",
      },
      {
        side: 'credit',
        role: 'by id',
        what: "Each line, the account the accountant's account maps to",
      },
    ],
    settings: [],
    sentence:
      'An entry the accountant wrote in the connected system arrives as one of ours on sync, so both sets of books hold it once.',
    disabledSentence:
      'The connected system has not been synced, so entries the accountant authored there are not in these books.',
    parameters: [
      {
        name: 'Never exported',
        value: 'Export route: none',
        sentence:
          'A synced entry is never pushed back: it would hand the accountant their own entry a second time, and both copies would balance.',
      },
      {
        name: 'Ours are skipped',
        value: 'Entries auxx pushed are recognised and not re-imported',
        sentence:
          'The sync drops every entry auxx authored before writing, or it would read our own ledger back and double it.',
      },
      {
        name: 'Floor',
        value: 'The month after the cutoff',
        sentence:
          'Nothing before the first month auxx keeps is read, because the opening entry was derived from it.',
      },
    ],
    records: [{ label: 'Connected system', href: '/app/accounting/settings/provider' }],
    enabled: false,
    exportRoute: 'none',
    singleWriterRoles: [],
  },

  // ── Never posting, and declared so ──────────────────────────────────────

  receipt: {
    type: 'receipt',
    label: 'Receipt',
    trigger: { kind: 'never' },
    template: [
      {
        side: 'debit',
        role: ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
        what: 'Raw materials received, at landed cost',
      },
      {
        side: 'debit',
        role: ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
        what: 'Finished goods received, at landed cost',
      },
      { side: 'credit', role: ACCOUNT_ROLES.GRNI, what: 'Goods received, not yet invoiced' },
      { side: 'credit', role: ACCOUNT_ROLES.FREIGHT_ACCRUAL, what: 'Freight accrued' },
      { side: 'credit', role: ACCOUNT_ROLES.DUTIES_ACCRUAL, what: 'Duties accrued' },
    ],
    settings: [],
    sentence: 'Receipts post nothing; inventory is asserted monthly.',
    disabledSentence:
      'Per-event receipt posting is off, so inventory moves only through the monthly assertion.',
    parameters: [
      {
        name: 'Method',
        value: 'Ready, not enabled',
        sentence:
          'The per-receipt entry is written and tested and waits for the switch that turns the monthly assertion off; both on at once would reverse each other.',
      },
    ],
    enabled: false,
    exportRoute: 'journal',
    singleWriterRoles: [
      ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
      ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
    ],
  },

  vendor_bill: {
    type: 'vendor_bill',
    label: 'Vendor bill',
    trigger: { kind: 'never' },
    template: [
      { side: 'debit', role: ACCOUNT_ROLES.GRNI, what: 'The receipt this bill invoices' },
      {
        side: 'debit',
        role: ACCOUNT_ROLES.PPV,
        what: 'Price variance against the order; the side follows the sign',
      },
      { side: 'credit', role: ACCOUNT_ROLES.ACCOUNTS_PAYABLE, what: 'What the vendor is owed' },
    ],
    settings: [],
    sentence: 'Purchasing bills post nothing per bill; inventory is asserted monthly.',
    disabledSentence:
      'Per-event vendor bill posting is off, so goods received not invoiced is not relieved per bill.',
    parameters: [
      {
        name: 'Method',
        value: 'Ready, not enabled',
        sentence:
          'Waits for the same switch as receipts. An expense bill is a different entry and does post.',
      },
    ],
    enabled: false,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  build: {
    type: 'build',
    label: 'Build',
    trigger: { kind: 'never' },
    template: [],
    settings: [],
    sentence: 'Builds post nothing; inventory is asserted monthly.',
    disabledSentence: 'Build posting is off.',
    parameters: [
      {
        name: 'Where a build shows up',
        value: 'The month-end entry',
        sentence:
          'Labour and overhead absorbed by builds reach the ledger through the month-end inventory entry, carrying the rates frozen on each movement.',
      },
    ],
    enabled: false,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  month_end_deferral: {
    type: 'month_end_deferral',
    label: 'Month-end deferral',
    trigger: { kind: 'never' },
    template: [],
    settings: [],
    sentence: 'No deferral entry is posted; nothing is deferred at month end.',
    disabledSentence: 'Month-end deferral posting is off.',
    parameters: [],
    enabled: false,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  month_end_reversal: {
    type: 'month_end_reversal',
    label: 'Month-end reversal',
    trigger: { kind: 'never' },
    template: [],
    settings: [],
    sentence:
      'No reversal entry is posted; a month is corrected by reversing its own entry from the ledger.',
    disabledSentence: 'Month-end reversal posting is off.',
    parameters: [],
    enabled: false,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },
}

/** Every policy, in declaration order. */
export const POSTING_POLICIES: readonly PostingPolicy[] = Object.values(POSTING_POLICY)
