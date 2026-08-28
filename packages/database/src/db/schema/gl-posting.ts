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
])

/**
 * Lifecycle of one journal entry.
 *
 * `reversed` is terminal, and it belongs to the ORIGINAL of a reversal pair —
 * the reversal itself is an ordinary `posted` entry (decision G4: a reversal is
 * a second, opposite entry; a period that has been posted never changes shape).
 */
export const glPostingStatus = pgEnum('GlPostingStatus', [
  'pending',
  'posted',
  'failed',
  'reversed',
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

    status: glPostingStatus().default('pending').notNull(),
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

    /** `'quickbooks'`, or `'none'` when nothing is connected. Never assumed. */
    providerId: text(),
    /** The provider's own id for the entry. NULL until a successful push. */
    providerEntryId: text(),

    postedAt: timestamp({ precision: 3 }),
    postedByUserId: text().references((): AnyPgColumn => User.id, { onDelete: 'set null' }),
    failureReason: text(),
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
