// packages/lib/src/accounting/ledger/post/policy.ts
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

import { ACCOUNT_ROLES, type AccountRole } from '../builders/entry'
import type { PostingType } from '../types'

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

  inventory_movement: {
    type: 'inventory_movement',
    label: 'Inventory movement',
    // Every inventory document writer, inside its own write's transaction.
    trigger: {
      kind: 'event',
      on: 'Every inventory document write: a shipment, a goods receipt, an adjustment, a build, a return, a return to the vendor, a revaluation, the opening run',
    },
    template: [
      {
        side: 'debit',
        role: ACCOUNT_ROLES.COGS_PRODUCT_COST,
        what: 'What left inventory on a sale, at the movements’ frozen cost',
      },
      {
        side: 'debit',
        role: ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
        what: 'Raw materials received, built or returned; the side follows the movement’s sign',
      },
      {
        side: 'debit',
        role: ACCOUNT_ROLES.INVENTORY_WIP,
        what: 'Work in process; the side follows the movement’s sign',
      },
      {
        side: 'debit',
        role: ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
        what: 'Finished goods; the side follows the movement’s sign',
      },
      { side: 'credit', role: ACCOUNT_ROLES.GRNI, what: 'Goods received, not yet invoiced' },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.INVENTORY_COUNT_VARIANCE,
        what: 'An adjustment or a scrap; the side follows the sign',
      },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.EQUITY_OPENING_BALANCE,
        what: 'The opening run’s balancing leg',
      },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.BUILD_VARIANCE,
        what: 'A build’s scrap and whatever the run missed the standard by',
      },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.INVENTORY_REVALUATION,
        what: 'A cost-only revaluation; the side follows the sign',
      },
    ],
    settings: [],
    sentence:
      'Every inventory document posts one entry of its own, at the cost frozen on the movements it links, the moment the document is written.',
    disabledSentence:
      'Inventory posting is off, so nothing moves the inventory accounts or cost of goods sold.',
    parameters: [
      {
        name: 'Method',
        value: 'Perpetual, per document',
        sentence:
          'One entry per document, with a member link to every `stock_movement` it booked; the month-end close checks that set rather than asserting a balance over it.',
      },
      {
        name: 'Cost',
        value: 'The movement’s frozen extended cost',
        sentence:
          'Never re-derived from today’s standard cost: the entry is worth exactly what the rows it links were worth when they were written.',
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
    // money/post-movement.ts, from the invoice receipt, the channel receipt and
    // the quote deposit.
    trigger: { kind: 'event', on: 'A customer receipt is recorded' },
    template: [
      {
        side: 'debit',
        role: ACCOUNT_ROLES.UNDEPOSITED_FUNDS,
        what: 'A receipt naming no destination, until a deposit run banks it',
      },
      {
        side: 'debit',
        role: ACCOUNT_ROLES.CLEARING,
        what: 'A receipt on a rail, until its payout',
      },
      { side: 'debit', role: 'by id', what: 'A receipt into a named bank account' },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
        what: 'The invoice an incoming payment settles',
      },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.CUSTOMER_DEPOSITS,
        what: 'Any amount not yet applied to an invoice, held as a deposit',
      },
    ],
    settings: ['accounting.autoPost.receipt'],
    sentence:
      'Every customer payment posts as it is recorded, landing where the payment itself says: a rail\u2019s clearing account, a bank account, or undeposited funds.',
    disabledSentence:
      'Payment posting is off, so receivables are never relieved and no customer money reaches clearing or the bank.',
    parameters: [
      {
        name: 'Destination',
        value: 'Per payment',
        sentence:
          "Where a payment lands is answered once, when it is recorded: a rail's clearing account, a bank account, or undeposited funds.",
      },
    ],
    records: [BANK_ACCOUNTS_RECORD, PAYMENT_GATEWAYS_RECORD],
    settingCopy: {
      'accounting.autoPost.receipt': {
        title: 'Auto-post receipts',
        description:
          'On, a payment posts immediately. Off, it drafts on the ledger for review and approval.',
      },
    },
    enabled: true,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  vendor_payment: {
    type: 'vendor_payment',
    label: 'Vendor payment',
    // money/vendor-payments/payment-accounting.ts, on a bill payment.
    trigger: { kind: 'event', on: 'A vendor payment is recorded' },
    template: [
      {
        side: 'debit',
        role: ACCOUNT_ROLES.ACCOUNTS_PAYABLE,
        what: 'The vendor bill the payment settles',
      },
      {
        side: 'credit',
        role: 'by id',
        what: 'The rail, bank account or undeposited funds the payment left by',
      },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.PURCHASE_DISCOUNTS,
        what: 'The part of a bill an early-payment discount settled, when one was taken',
      },
    ],
    settings: ['accounting.autoPost.vendorPayment'],
    sentence:
      'A vendor payment posts as it is recorded, relieving the payable and leaving by whatever the payment itself names.',
    disabledSentence:
      'Vendor payment posting is off, so payables are never relieved and no money ever leaves the books for a supplier.',
    parameters: [
      {
        name: 'Discount',
        value: 'One entry',
        sentence:
          'An early-payment discount taken is a credit line on the same entry, so voiding the payment unwinds both legs (74 D3).',
      },
    ],
    records: [BANK_ACCOUNTS_RECORD],
    settingCopy: {
      'accounting.autoPost.vendorPayment': {
        title: 'Auto-post vendor payments',
        description:
          'On, a vendor payment or refund posts immediately. Off, it drafts on the ledger for review and approval.',
      },
    },
    enabled: true,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  refund: {
    type: 'refund',
    label: 'Refund',
    // money/customer-money/refund-accounting.ts on a customer refund.
    trigger: { kind: 'event', on: 'A customer refund is recorded' },
    template: [
      {
        side: 'debit',
        role: 'by id',
        what: "The credit memo's own control account, as its issue entry credited it",
      },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.CLEARING,
        what: 'A refund on a rail, until the payout nets it',
      },
      { side: 'credit', role: 'by id', what: 'A refund out of a named bank account' },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.UNDEPOSITED_FUNDS,
        what: 'A refund naming no source',
      },
    ],
    settings: ['accounting.autoPost.refund'],
    sentence:
      "A refund posts as it is issued, leaving by whatever the refund itself names: a rail's clearing account, a bank account, or undeposited funds.",
    disabledSentence:
      'Refund posting is off, so money given back to a customer never leaves the books and returns are never recognised.',
    parameters: [
      {
        name: 'Destination',
        value: 'Per refund',
        sentence:
          'A refund is a forward event: it names its own rail or bank account, pre-filled from the receipt it settles, and resolves it at refund time.',
      },
    ],
    records: [BANK_ACCOUNTS_RECORD, PAYMENT_GATEWAYS_RECORD],
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

  vendor_refund: {
    type: 'vendor_refund',
    label: 'Vendor refund',
    // money/vendor-payments/refund-accounting.ts on a supplier's refund of a
    // vendor credit (71 U7).
    trigger: { kind: 'event', on: "A supplier's refund of a vendor credit is recorded" },
    template: [
      {
        side: 'debit',
        role: 'by id',
        what: 'The endpoint the money arrives into',
      },
      {
        side: 'credit',
        role: ACCOUNT_ROLES.ACCOUNTS_PAYABLE,
        what: "The vendor credit's own control account, as its issue entry debited it",
      },
    ],
    // The vendor payment's lane, arriving instead of leaving: one switch for
    // money either way with a supplier, as `receipt` is for a customer.
    settings: ['accounting.autoPost.vendorPayment'],
    sentence:
      "A supplier's refund of a vendor credit posts as it is recorded, arriving into whatever endpoint it names and settling the credit.",
    disabledSentence:
      'Vendor refund posting is off, so money a supplier gives back never reaches the books and the vendor credit stays open.',
    parameters: [
      {
        name: 'Control account',
        value: 'Read off the credit',
        sentence:
          "The account the refund settles is the vendor credit's own posted control line, never re-resolved, and a refund may not precede the credit's issue date.",
      },
    ],
    records: [BANK_ACCOUNTS_RECORD],
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
        value: 'Sync now',
        sentence:
          'Sync now on the Payouts page reads and posts the payouts of one rail immediately; there is no payout webhook, so the nightly run is what catches everything else.',
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

  vendor_credit: {
    type: 'vendor_credit',
    label: 'Vendor credit',
    // purchasing/vendor-credit/accounting.ts `postEntry` call, on Issue.
    trigger: { kind: 'event', on: "Issue on a supplier's credit note" },
    template: [
      { side: 'debit', role: ACCOUNT_ROLES.ACCOUNTS_PAYABLE, what: 'The supplier is owed less' },
      {
        side: 'credit',
        role: 'by id',
        what: 'Each line, the account the original charge was coded to',
      },
    ],
    settings: ['accounting.autoPost.vendorCredit'],
    sentence:
      "Issuing a supplier's credit note reduces the payable and gives back whatever the original bill was coded to, dated the credit.",
    disabledSentence:
      'Vendor credit posting is off, so a supplier credit note never reduces the payable and the original expense stands.',
    parameters: [
      {
        name: 'Short shipment',
        value: 'Coded to GRNI',
        sentence:
          "A credit raised against a purchase-order bill is prefilled with the organisation's goods-received-not-invoiced account, so the accrual clears rather than the expense.",
      },
      {
        name: 'Returned goods',
        value: 'Recorded, not restocked',
        sentence:
          'A vendor credit is the money side only; a physical return to the supplier is its own stock movement.',
      },
    ],
    settingCopy: {
      'accounting.autoPost.vendorCredit': {
        title: 'Auto-post vendor credits',
        description:
          'On, a vendor credit posts immediately on Issue. Off, it drafts on the ledger for review and approval.',
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

  vendor_bill: {
    type: 'vendor_bill',
    label: 'Vendor bill',
    // purchasing/expense-bill/writes.ts `postVendorBill`, on Post. ONE door for
    // both kinds of bill since 73 D3; the three-way match posts nothing.
    trigger: {
      kind: 'event',
      on: 'Post on a vendor bill, whether it names a purchase order or not',
    },
    template: [
      {
        side: 'debit',
        role: ACCOUNT_ROLES.GRNI,
        what: 'Each line matched to an order line, at the quantity billed times the agreed price',
      },
      {
        side: 'debit',
        role: ACCOUNT_ROLES.PPV,
        what: 'Price variance against the order; the side follows the sign',
      },
      { side: 'debit', role: 'by id', what: 'Each unmatched line, the account it was coded to' },
      {
        side: 'debit',
        role: ACCOUNT_ROLES.FREIGHT_ACCRUAL,
        what: "The header's shipping, which the receipt already accrued",
      },
      { side: 'debit', role: ACCOUNT_ROLES.PURCHASE_TAX, what: "The header's tax" },
      { side: 'credit', role: ACCOUNT_ROLES.ACCOUNTS_PAYABLE, what: 'What the vendor is owed' },
    ],
    settings: ['accounting.autoPost.expenseBill'],
    sentence:
      'Posting a vendor bill raises the payable for what the vendor is asking: a line against a purchase order relieves the goods-received accrual at the agreed price and books the difference as purchase price variance, and any other line lands on the account it was coded to.',
    disabledSentence:
      'Vendor bill posting is off, so no bill raises a payable, goods received not invoiced is never relieved and the accrual grows without bound.',
    parameters: [
      {
        name: 'The accrual relieved',
        value: 'Quantity BILLED at the agreed price',
        sentence:
          'What the vendor is invoicing, not what has been received, so a short shipment stays in the accrual as invoiced-not-received rather than reading as a price variance (73 D2).',
      },
      {
        name: 'The match verdict',
        value: 'Not consulted',
        sentence:
          'A bill posts whether it is awaiting its goods, matched or in exception; the verdict is a control, never a posting trigger.',
      },
      {
        name: 'Totals',
        value: "The vendor's, transcribed",
        sentence:
          "The bill's totals are copied from the vendor's document and never recomputed, and the entry refuses unless the lines, shipping, tax and discount tie to the stated total.",
      },
    ],
    settingCopy: {
      'accounting.autoPost.expenseBill': {
        title: 'Auto-post vendor bills',
        description:
          'On, a bill posts immediately on Post. Off, it drafts on the ledger for review and approval.',
      },
    },
    enabled: true,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  landed_cost_clear: {
    type: 'landed_cost_clear',
    label: 'Landed cost cleared',
    // purchasing/landed-cost/clear.ts `postEntry` call, on Clear.
    trigger: { kind: 'event', on: "Clear on a goods bill's landed cost" },
    template: [
      {
        side: 'debit',
        role: ACCOUNT_ROLES.FREIGHT_ACCRUAL,
        what: 'Freight the receipts accrued and no carrier ever billed',
      },
      {
        side: 'debit',
        role: ACCOUNT_ROLES.DUTIES_ACCRUAL,
        what: 'Duty the receipts accrued and no broker ever billed',
      },
      { side: 'credit', role: ACCOUNT_ROLES.PPV, what: 'The under-run, as a period variance' },
    ],
    // Inventory's lane, and it posts the moment Clear is pressed, as every
    // other inventory entry does - a clear is a person's own action.
    settings: [],
    sentence:
      "Clearing a shipment's landed cost takes the freight and duty its receipts accrued and nobody billed back out of the accruals, against purchase price variance.",
    disabledSentence:
      'Landed cost clearing is off, so a shipment nobody finished billing leaves its freight and duty estimates sitting in the accruals forever.',
    parameters: [
      {
        name: 'No stock revaluation',
        value: 'A period variance',
        sentence:
          "The difference between an estimate and what was billed is a variance of the period, never a restatement of the stock's cost (73 D6), so nothing on hand moves.",
      },
      {
        name: 'A late bill',
        value: 'Posts to variance',
        sentence:
          'A carrier or broker bill arriving after a clear finds nothing left accrued and posts entirely to purchase price variance.',
      },
    ],
    enabled: true,
    exportRoute: 'journal',
    singleWriterRoles: [],
  },

  // ── Never posting, and declared so ──────────────────────────────────────

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
