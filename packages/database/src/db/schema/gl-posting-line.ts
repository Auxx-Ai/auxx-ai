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
     * Account CODE — `'1310'` — never a provider account id, and never a foreign
     * key.
     *
     * Decision P2. A ledger line must outlive the chart row: an FK to the
     * `gl_account` `EntityInstance` would either block deleting an account that
     * has ever been posted to, or cascade and destroy history. Neither is
     * acceptable in a general ledger, and P2's whole cash value is that a code is
     * ours — it means the same thing in every provider and in none, and it makes
     * an entry auditable three years later with no API call.
     */
    accountCode: text().notNull(),
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

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    // NO updatedAt. A ledger line is never updated. A mistake is a reversing entry.
  },
  (table) => [
    uniqueIndex('GlPostingLine_posting_lineNumber_key').using(
      'btree',
      table.glPostingId.asc().nullsLast(),
      table.lineNumber.asc().nullsLast()
    ),
    // The trial balance: SUM(amountMinor) FILTER (WHERE direction='debit') GROUP BY accountCode.
    index('GlPostingLine_org_accountCode_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.accountCode.asc().nullsLast()
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
    check('GlPostingLine_accountCode_check', sql`length(trim(${table.accountCode})) > 0`),
    check('GlPostingLine_lineNumber_check', sql`${table.lineNumber} > 0`),
  ]
)

export type GlPostingLineEntity = typeof GlPostingLine.$inferSelect
export type CreateGlPostingLineInput = typeof GlPostingLine.$inferInsert
