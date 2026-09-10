// packages/database/src/db/schema/gl-posting-line.ts
// One leg of a double entry. APPEND-ONLY: no `updatedAt`, no update function,
// ever. A mistake is corrected by a reversing entry (decision G4), exactly as
// `stock_movement` is corrected by `reverseMovement`.
//
// On the entity route `updatable: false` is advisory — it is read by the grid
// cell and the connector catalog and by NOTHING on the write path, so a later
// `fieldValue.set` could rewrite one line's amount on a posted entry and
// silently unbalance the books. Here immutability is structural: the table has
// no `updatedAt` column to stamp and the module exposes no update.

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { GlPosting, glPostingDirection } from './gl-posting'
import { Organization } from './organization'

/** One line of a double entry. Never opened as a record; never updated. */
export const GlPostingLine = pgTable(
  'GlPostingLine',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    glPostingId: text()
      .notNull()
      .references((): AnyPgColumn => GlPosting.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    /** 1-based, stable presentation order within the entry. */
    lineNumber: integer().notNull(),

    /**
     * The `gl_account` `EntityInstance` id this line posted to. The IDENTITY
     * (plans/accounting/tasks/15-the-account-id-is-the-identity.md §2.1).
     *
     * No foreign key, deliberately - the call `GlRoleAssignment.glAccountId`
     * already makes, for its reasons. A ledger line must outlive the chart row,
     * so `cascade` would destroy history and `restrict` would block an archive.
     * Readers validate and fail closed, which they have to do anyway.
     *
     * `accountCode` and `accountName` beside it are SNAPSHOTS of how the account
     * read at post time. This is what it WAS; those are what it was CALLED.
     */
    glAccountId: text().notNull(),
    /**
     * Account CODE, e.g. `'1310'`, a SNAPSHOT of the code the account carried
     * at post time, beside `accountName`. `glAccountId` above is the identity
     * now; a report should group by it rather than by this column, because a
     * code is a label the owner may rename or renumber and the ledger must not
     * re-partition when they do (task 15 §0.4).
     *
     * NULLABLE (task 15 §5): the account may carry no code at all - a chart
     * imported from a provider that ships with account numbers off, or one a
     * person keeps by name alone. A snapshot of nothing is null, exactly as
     * `accountName` already is.
     *
     * Never a provider account id, and never a foreign key (decision P2): a
     * ledger line must outlive the chart row, so an FK to the `gl_account`
     * `EntityInstance` would either block deleting an account that has ever been
     * posted to, or cascade and destroy history.
     */
    accountCode: text(),
    /**
     * The logical account ROLE the builder emitted — `'grni'`,
     * `'inventory_raw_materials'`, `'ppv'` — which `accountCode` was resolved
     * from (decision G8). Nullable
     * because a manual or legacy entry may name a code directly, and because the
     * role vocabulary is `ACCOUNT_ROLES` in
     * `packages/lib/src/postings/build-entry.ts`, not here: this column STORES a
     * role, it does not define the set. Plain `text` rather than a `pgEnum` on
     * purpose — a second copy of that vocabulary is the thing that would drift,
     * and `GlRoleAssignment.role` makes the same call for the same reason.
     *
     * Recorded on the line for the same reason `accountName` is: once the chart
     * is org-editable (G7) the number stops carrying the meaning, and without the
     * role a posted line cannot answer "which account was this SUPPOSED to be".
     */
    accountRole: text(),
    /**
     * The account's name AS IT STOOD when the entry was posted. A snapshot, like
     * a movement's frozen cost: renaming `2160` next year must not rewrite last
     * year's ledger. Nullable — an entry may be posted before the chart carries
     * the name.
     */
    accountName: text(),

    direction: glPostingDirection().notNull(),
    /**
     * Integer minor units. ALWAYS > 0 — `direction` is the only carrier of sign
     * (decision G2).
     *
     * `bigint({ mode: 'number' })` for the reason on `GlPosting.totalMinor`:
     * int4's $21,474,836.47 ceiling is 4.7x under a balance this org already
     * carries, and a line that cannot be written is a close that cannot run.
     */
    amountMinor: bigint({ mode: 'number' }).notNull(),
    memo: text(),

    /** `'stock_movement'` / `'vendor_bill'` + the row id. The audit trail (decision G3). */
    sourceType: text().notNull(),
    sourceId: text().notNull(),

    /**
     * Who this line is attributable to, when the account requires it - `'customer'`
     * or `'vendor'` (`plans/accounting/tasks/13-cash-accounts-and-the-qbo-seam.md`
     * §1.1). Set ONLY on a receivable or payable line, and FROZEN here at post
     * time so a retry exports under the attribution the ledger asserted, never
     * one re-resolved after a merge or a rename - the same reason `accountCode`
     * is a snapshot rather than a live read.
     *
     * Plain `text` rather than a `pgEnum`, for the reason `accountRole` gives:
     * the vocabulary is `CounterpartyType` in `packages/lib/src/postings/types.ts`,
     * not here, and a second copy here is the thing that would drift.
     */
    counterpartyType: text(),
    /**
     * OUR record id (P2, never a provider id) - a `contact` instance id when
     * `counterpartyType` is `'customer'`, a `company` instance id when it is
     * `'vendor'`. No foreign key, for the same reason `glAccountId` has none: a
     * ledger line must outlive the contact or company row it names. Null on
     * every line that names no receivable or payable, which is most of them.
     */
    counterpartyId: text(),

    /**
     * Reporting dimensions on the line - `{ channel: 'dtc', class: '...' }` -
     * as an open JSON object. NULLABLE and, as of 2026-09-04, WRITTEN BY
     * NOTHING (plans/accounting/HANDOFF.md decision 6.5): the column exists so
     * that adding a dimension later is a builder change, not a table migration
     * over a ledger that already holds history. Never a lookup key.
     */
    dimensions: jsonb(),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    // NO updatedAt. A ledger line is never updated. A mistake is a reversing entry.
  },
  (table) => [
    uniqueIndex('GlPostingLine_posting_lineNumber_key').using(
      'btree',
      table.glPostingId.asc().nullsLast(),
      table.lineNumber.asc().nullsLast()
    ),
    // The trial balance still groups by the code as of this migration (task 15
    // §3 is the follow-up that moves it to `glAccountId`). Kept regardless: a
    // historical-code lookup stays a legitimate read - `account-lines.ts` drills
    // into a code from a statement row.
    index('GlPostingLine_org_accountCode_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.accountCode.asc().nullsLast()
    ),
    // The identity read: every line posted to one account, current chart or not.
    index('GlPostingLine_org_glAccountId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.glAccountId.asc().nullsLast()
    ),
    // "What did this movement post to?" — the reverse audit read.
    index('GlPostingLine_org_source_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.sourceType.asc().nullsLast(),
      table.sourceId.asc().nullsLast()
    ),
    index('GlPostingLine_glPostingId_idx').using('btree', table.glPostingId.asc().nullsLast()),

    check('GlPostingLine_amount_check', sql`${table.amountMinor} > 0`),
    check('GlPostingLine_lineNumber_check', sql`${table.lineNumber} > 0`),
  ]
)

export type GlPostingLineEntity = typeof GlPostingLine.$inferSelect
export type CreateGlPostingLineInput = typeof GlPostingLine.$inferInsert
