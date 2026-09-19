// packages/database/src/db/schema/gl-posting.ts
// The general ledger, ours. One GlPosting is one journal entry; its lines
// (`GlPostingLine`) are the double entry. Model of record:
// plans/money/design/gl-posting-tables.md (decision G6).
//
// WHY THIS IS A TABLE AND NOT AN `EntityInstance`
// `FieldValue` carries exactly two unique indexes — the PK and
// `(entityId, fieldId, sortKey)` — so a composite uniqueness constraint across
// two FIELDS of an instance is not merely unimplemented, it is unexpressible.
// The double-post defence is a partial unique index on `GlPostingSource`
// (see that file), and nothing on the entity route can express it.

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from './_shared'
import { FinancialSourceAccount } from './financial-source-account'
import { Organization } from './organization'
import { User } from './user'

/**
 * What produced a posting.
 *
 * Mirrors `POSTING_TYPES` in `packages/lib/src/accounting/ledger/types.ts`.
 */
export const glPostingType = pgEnum('GlPostingType', [
  'fulfillment',
  'payout',
  'month_end_deferral',
  'month_end_reversal',
  // MIGRATION step 5, drizzle 0381. One entry per inventory DOCUMENT at frozen
  // movement cost; `stock_movement` is the subledger it links its members to.
  'inventory_movement',
  'vendor_bill',
  // Added 2026-09-04 (plans/accounting/HANDOFF.md slot 0B). Kept in step with
  // `POSTING_TYPES` by `lib/postings/__tests__/types.test.ts`.
  'manual_journal',
  'opening_balance',
  'bank_transaction',
  'bank_deposit',
  'write_off',
  // Slot 2G phase B, drizzle 0362.
  'payment',
  // TARGET §5: a customer refund, its own type rather than a sides-swapped
  // `payment`, so the export can send a Refund Receipt and the ledger card can
  // name it. Added by MIGRATION step 2, drizzle 0378.
  'refund',
  // plans/accounting/tasks/done/08-invoice-revenue.md and 07-customer-deposits.md,
  // drizzle 0362. An invoice's issuance entry, and the reclass of a held
  // customer deposit out of the liability and onto a receivable.
  'invoice_issued',
  'deposit_application',
  // plans/accounting/tasks/done/10-credit-memos.md: the issue entry of a credit memo,
  // Dr 4090 / Dr sales tax payable / Cr A/R.
  'credit_memo',
  // plans/accounting/tasks/20-two-authors-one-ledger.md §6: an entry the
  // ACCOUNTANT authored in the connected provider, read back off their general
  // ledger and written as one of our rows.
  //
  // 🛑 It is the one posting type auxx does not author, and
  // its avenue is null, which is what stops us pushing their own entries back
  // at them. `periodKey` is the provider's transaction id, so the claim index
  // gives per-transaction idempotency for free.
  'provider_sync',
  'recurring_journal',
  'expense_bill',
  // plans/accounting/tasks/71-one-cash-endpoint.md §5 U7: a supplier's credit
  // note - `Dr A/P / Cr <each line's account>`, the expense bill sides-flipped.
  'vendor_credit',
])

/**
 * Lifecycle of one journal entry, in OUR books: `draft -> posted -> reversed`.
 *
 * A draft has lines and no doc number and holds no claim; posting assigns both.
 * `reversed` is terminal and belongs to the ORIGINAL of a reversal pair - the
 * reversal itself is an ordinary `posted` entry (decision G4).
 *
 * 🛑 `pending` and `failed` were never ledger states; they were EXPORT states
 * wearing this column's name. What the export did lives on `ExportBatch`.
 */
export const glPostingStatus = pgEnum('GlPostingStatus', ['draft', 'posted', 'reversed'])

/** Which side of the entry a line sits on. The ONLY carrier of sign (decision G2). */
export const glPostingDirection = pgEnum('GlPostingDirection', ['debit', 'credit'])

/** One journal entry. The claim lives on `GlPostingSource`'s subject row, not here. */
export const GlPosting = pgTable(
  'GlPosting',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    postingType: glPostingType().notNull(),
    /** `'2026-08-18'` or `'2026-08'`, or a payout/build id. Parsed by `postings/periods.ts`. */
    periodKey: text().notNull(),
    /**
     * 0 for the original. A reversal of revision N claims N+1.
     *
     * This is what lets a period be re-entered without polluting `periodKey`.
     * The rejected alternative was suffixing the key (`'2026-08:rev'`), which
     * `parsePeriodKey` throws `BadRequestError` on — the very module that owns
     * the keyspace would reject it.
     */
    revision: integer().default(0).notNull(),

    status: glPostingStatus().default('posted').notNull(),
    /** The accounting date. Always explicit — providers default to their own server date. */
    txnDate: date().notNull(),
    /** Deterministic, <= 21 chars (QBO `DocNumber`). NULL while the entry is a draft. */
    docNumber: text(),

    /** Which `FinancialSourceAccount` the entry resolved through, so a summary can group by it. */
    storeId: text().references((): AnyPgColumn => FinancialSourceAccount.id, {
      onDelete: 'set null',
    }),
    /** The `payment_gateway` instance the entry resolved through. An entity record id, so no FK. */
    railId: text(),

    /** ISO 4217. USD only for the cutover; asserted in the poster, never assumed. */
    currency: text().default('USD').notNull(),
    /**
     * Integer minor units. Equals both the debit and the credit total, by
     * construction.
     *
     * `bigint`, not `integer`: int4 tops out at 2,147,483,647 minor units —
     * $21,474,836.47 — and this org already holds ~$100M in a single account,
     * 4.7x over. Postgres raises `22003` rather than wrapping, so the failure
     * mode was a month-end close that simply REFUSES to post.
     *
     * `mode: 'number'` on purpose: a JS number is exact to 2^53 minor units
     * (~$90 trillion), which is orders of magnitude past anything real here,
     * and it keeps `number` as the type through `build-entry.ts` and the pure
     * builders. `mode: 'bigint'` would push BigInt plumbing through every
     * builder to buy range nobody will use.
     */
    totalMinor: bigint({ mode: 'number' }).notNull(),

    /**
     * The built entry, verbatim, as `{ v: 1, … }`. The audit record of WHAT WAS
     * POSTED, including decision G3's `sources` provenance. Reconstructing it
     * from the subledger later gives a different answer once the subledger
     * moves — which is exactly the property a ledger must not have.
     */
    built: jsonb().notNull(),

    postedAt: timestamp({ precision: 3 }),
    postedByUserId: text().references((): AnyPgColumn => User.id, { onDelete: 'set null' }),

    /** For a reversal: the posting it reverses. Self-referential, never cascading. */
    reversesId: text().references((): AnyPgColumn => GlPosting.id, { onDelete: 'restrict' }),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // A deterministic docNumber colliding is already a bug — catch it here, not at the provider.
    uniqueIndex('GlPosting_org_docNumber_key').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.docNumber.asc().nullsLast()
    ),

    // The close console's two reads: the work queue, and a period's entries.
    index('GlPosting_org_status_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.status.asc().nullsLast()
    ),
    index('GlPosting_org_txnDate_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.txnDate.asc().nullsLast()
    ),
    // Walking a reversal chain back to its original.
    index('GlPosting_reversesId_idx').using('btree', table.reversesId.asc().nullsLast()),

    check('GlPosting_totalMinor_check', sql`${table.totalMinor} >= 0`),
    check('GlPosting_revision_check', sql`${table.revision} >= 0`),
    // A reversal must name what it reverses; an original must not name anything.
    check(
      'GlPosting_reversal_check',
      sql`(${table.revision} = 0 AND ${table.reversesId} IS NULL) OR (${table.revision} > 0 AND ${table.reversesId} IS NOT NULL)`
    ),
    // `posted` is the only status that may carry a posted timestamp.
    check(
      'GlPosting_posted_check',
      sql`${table.status} <> 'posted' OR ${table.postedAt} IS NOT NULL`
    ),
  ]
)

export type GlPostingEntity = typeof GlPosting.$inferSelect
export type CreateGlPostingInput = typeof GlPosting.$inferInsert
