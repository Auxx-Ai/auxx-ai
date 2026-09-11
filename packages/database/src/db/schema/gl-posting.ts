// packages/database/src/db/schema/gl-posting.ts
// The general ledger, ours. One GlPosting is one journal entry; its lines
// (`GlPostingLine`) are the double entry. Model of record:
// plans/money/design/gl-posting-tables.md (decision G6).
//
// WHY THIS IS A TABLE AND NOT AN `EntityInstance`
// `FieldValue` carries exactly two unique indexes — the PK and
// `(entityId, fieldId, sortKey)` — so a composite uniqueness constraint across
// two FIELDS of an instance is not merely unimplemented, it is unexpressible: a
// unique index constrains within a row and two fields are two rows. The entire
// double-post defence is
// `INSERT … ON CONFLICT (organizationId, postingType, periodKey, revision) DO
// NOTHING RETURNING *`, and nothing on the entity route can express it.
// Provider-side idempotency (a QBO `requestid`, a deterministic `DocNumber`)
// protects the EXPORTER; under decision P1 auxx.ai is the system of record, and
// a ledger holding two of an entry is wrong whether or not QuickBooks noticed.

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
  uniqueIndex,
} from './_shared'
import { Organization } from './organization'
import { User } from './user'

/**
 * What produced a posting.
 *
 * Mirrors `POSTING_TYPES` in `packages/lib/src/postings/types.ts`. The first six
 * are the L1 monthly/periodic entries; `receipt` and `vendor_bill` are the L3
 * per-event entries and are carried here from day one because widening a
 * Postgres enum later is a migration and carrying a value nothing writes is
 * free.
 */
export const glPostingType = pgEnum('GlPostingType', [
  'fulfillment',
  'payout',
  'build',
  'month_end_deferral',
  'month_end_reversal',
  'month_end_inventory',
  'receipt',
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
  // plans/accounting/tasks/08-invoice-revenue.md and 07-customer-deposits.md,
  // drizzle 0362. An invoice's issuance entry, and the reclass of a held
  // customer deposit out of the liability and onto a receivable.
  'invoice_issued',
  'deposit_application',
  // plans/accounting/tasks/10-credit-memos.md: the issue entry of a credit memo,
  // Dr 4090 / Dr sales tax payable / Cr A/R.
  'credit_memo',
  // plans/accounting/tasks/20-two-authors-one-ledger.md §6: an entry the
  // ACCOUNTANT authored in the connected provider, read back off their general
  // ledger and written as one of our rows.
  //
  // 🛑 It is the one posting type auxx does not author, and
  // `EXPORT_ROUTE_BY_POSTING_TYPE.provider_sync = 'none'` is what stops us
  // pushing their own entries back at them. `periodKey` is the provider's
  // transaction id, so the claim index gives per-transaction idempotency for
  // free; `exportStatus` stays `not_required` because we never pushed it.
  'provider_sync',
  'recurring_journal',
  'expense_bill',
])

/**
 * Lifecycle of one journal entry, in OUR books.
 *
 * 🛑 Two values. The pair that used to sit here — `pending` and `failed` — were
 * never ledger states; they were EXPORT states wearing this column's name, and
 * a provider refusal that flipped this column to `failed` took the entry out of
 * every report while the money it described was perfectly real. See
 * {@link glPostingExportStatus} and plans/accounting/export-state-split.md.
 *
 * Every ledger-side question is settled BEFORE the claim: `postEntry` takes the
 * period lock (step 1), resolves roles (2) and re-asserts balance (3) before it
 * claims (5), then writes the lines in the SAME transaction as the claim (6).
 * So a row that exists with lines under it has already passed everything we get
 * to decide, which is why `posted` is stamped there rather than after a third
 * party acknowledges it. A pre-claim refusal writes no row at all — that is why
 * there is no status describing one.
 *
 * `reversed` is terminal, and it belongs to the ORIGINAL of a reversal pair —
 * the reversal itself is an ordinary `posted` entry (decision G4: a reversal is
 * a second, opposite entry; a period that has been posted never changes shape).
 */
export const glPostingStatus = pgEnum('GlPostingStatus', ['posted', 'reversed'])

/**
 * What the EXPORT of this entry to the accounting provider did.
 *
 * 🛑 Nothing on this column may change what the books say. Decision P1 makes the
 * accounting system an EXPORTER and auxx.ai the system of record; that only
 * holds if a provider's answer lands somewhere the statements do not read.
 *
 * - `not_required` — nothing is connected, or pushing is disabled. A supported
 *   configuration, and deliberately NOT collapsed into `exported`: an org that
 *   never had an accounting system has not exported anything, and merging the
 *   two makes "is everything exported?" unanswerable on the one setup P1 calls
 *   fully supported.
 * - `pending` — claimed, and the push has not answered yet.
 * - `exported` — the provider took it. `providerEntryId` is set.
 * - `failed` — the provider refused. `failureReason` and `attempts` say why and
 *   how often. Retried by `retryExport`, never by re-posting.
 */
export const glPostingExportStatus = pgEnum('GlPostingExportStatus', [
  'not_required',
  'pending',
  'exported',
  'failed',
])

/** Which side of the entry a line sits on. The ONLY carrier of sign (decision G2). */
export const glPostingDirection = pgEnum('GlPostingDirection', ['debit', 'credit'])

/** One journal entry. The claim on `(org, type, period, revision)` is what this table is for. */
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

    /**
     * Defaults to `posted`, not to a draft state: a row exists only once the
     * claim and its lines have committed, and by then every ledger-side check
     * has passed. There is no moment at which a GlPosting row is legitimately
     * un-posted.
     */
    status: glPostingStatus().default('posted').notNull(),
    /** The accounting date. Always explicit — providers default to their own server date. */
    txnDate: date().notNull(),
    /** Deterministic. Also the provider's document number. <= 21 chars (QBO `DocNumber`). */
    docNumber: text().notNull(),

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
    draft: jsonb().notNull(),

    /**
     * Deterministic, derived from posting identity ALONE — no run salt. Two runs
     * of the same period must produce the same key or the provider's idempotency
     * guarantee never fires on the one case it exists for. Written at claim time
     * and reused verbatim by every retry.
     */
    requestId: text().notNull(),

    /**
     * What the export did. Never what the ledger did — see
     * {@link glPostingExportStatus}.
     *
     * Defaults to `not_required` so a row written by anything that does not know
     * about providers (a test factory, a fixture) reads as "nothing to export"
     * rather than as an export that is owed and will never happen.
     */
    exportStatus: glPostingExportStatus().default('not_required').notNull(),

    /** `'quickbooks'`, or `'none'` when nothing is connected. Never assumed. */
    providerId: text(),
    /** The provider's own id for the entry. NULL until a successful push. */
    providerEntryId: text(),
    /**
     * WHICH instance of the provider the entry went to - a QuickBooks realm, a
     * Xero tenant, a NetSuite account. Supplied by the adapter; the core never
     * parses it.
     *
     * 🛑 `providerId` says WHAT system answered and `providerEntryId` is that
     * system's id for the entry, but a provider id is a per-COMPANY sequence:
     * entry `147` exists in every QuickBooks company and means something
     * different in each. Without this column a company switch silently
     * reinterprets every exported row and nothing downstream can tell.
     *
     * NULL means NO EXPORT REACHED A PROVIDER - a `none`-provider posting, or
     * one that was never pushed. A normal, permanent state under decision P1,
     * not a migration artefact.
     *
     * 🛑 **Written at export time or not at all.** An exported row's tenant can
     * never be reconstructed afterwards: stamping one from the org's CURRENTLY
     * connected realm is right only for an org that never switched - which is
     * exactly the org this column does nothing for - and wrong for the one it
     * exists to catch. That is why both write sites (`postings/post-entry.ts`
     * and `postings/retry-export.ts`) stamp it, and why they have to move
     * together: a retry path that stops stamping produces the unreconstructable
     * row silently. See plans/accounting/tasks/24-the-company-on-the-entry.md §2.
     */
    providerTenantId: text(),

    postedAt: timestamp({ precision: 3 }),
    postedByUserId: text().references((): AnyPgColumn => User.id, { onDelete: 'set null' }),
    /**
     * Why the EXPORT was refused. Never why a posting was refused — there is no
     * such row.
     *
     * Cleared by a later success, unlike `attempts`: the count stays true
     * afterwards, the reason does not. Every screen reads this as current, so a
     * row that exported on its third attempt while still carrying attempt two's
     * refusal describes itself as broken (task 24 §6.2).
     */
    failureReason: text(),
    /** How many times the EXPORT has been attempted. Not cleared by a later success. */
    attempts: integer().default(0).notNull(),

    /** For a reversal: the posting it reverses. Self-referential, never cascading. */
    reversesId: text().references((): AnyPgColumn => GlPosting.id, { onDelete: 'restrict' }),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // ── THE CLAIM. Everything else in this file is bookkeeping around this line. ──
    uniqueIndex('GlPosting_org_type_period_revision_key').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.postingType.asc().nullsLast(),
      table.periodKey.asc().nullsLast(),
      table.revision.asc().nullsLast()
    ),

    // A deterministic docNumber colliding is already a bug — catch it here, not at the provider.
    uniqueIndex('GlPosting_org_docNumber_key').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.docNumber.asc().nullsLast()
    ),

    // One provider entry maps to one posting. Partial: NULL until posted, and an
    // org with no provider connected never populates it.
    uniqueIndex('GlPosting_org_provider_entry_key')
      .using(
        'btree',
        table.organizationId.asc().nullsLast(),
        table.providerId.asc().nullsLast(),
        table.providerEntryId.asc().nullsLast()
      )
      .where(sql`${table.providerEntryId} IS NOT NULL`),

    // The close console's two reads: the work queue, and a period's entries.
    index('GlPosting_org_status_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.status.asc().nullsLast()
    ),
    // The export queue: "what is in the books but not in QuickBooks".
    index('GlPosting_org_exportStatus_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.exportStatus.asc().nullsLast()
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
    check('GlPosting_attempts_check', sql`${table.attempts} >= 0`),
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
