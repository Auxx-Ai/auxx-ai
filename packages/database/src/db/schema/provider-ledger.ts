// packages/database/src/db/schema/provider-ledger.ts
// A raw copy of the connected provider's ledger, in its own tables. See
// plans/accounting/TARGET.md §2: it never mixes with `GlPosting`, it includes
// the objects we sent, and it is the source both the translation and the
// export's readback read.

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { ExternalAccountingBook } from './external-accounting-book'
import { Organization } from './organization'

/**
 * Who wrote the entry. `'auxx'` when its document number is one of ours,
 * `'provider'` otherwise — the ours-vs-theirs partition, stored rather than
 * recomputed per run. Only `'provider'` entries are translated into `GlPosting`.
 */
export const providerLedgerAuthor = pgEnum('ProviderLedgerAuthor', ['auxx', 'provider'])

export const ProviderLedgerEntry = pgTable(
  'ProviderLedgerEntry',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    bookId: text()
      .notNull()
      .references((): AnyPgColumn => ExternalAccountingBook.id, { onDelete: 'cascade' }),
    /** The provider's transaction type VERBATIM: `'Journal Entry'`, `'Bill Payment'`. */
    providerTxnType: text().notNull(),
    providerTxnId: text().notNull(),
    /** The provider's own accounting date, `YYYY-MM-DD`, kept as a string. */
    txnDate: text().notNull(),
    docNumber: text(),
    syncToken: text(),
    author: providerLedgerAuthor().notNull(),
    raw: jsonb(),
    fetchedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    /**
     * Set when a re-read of the same range stopped returning this transaction.
     * Convergence is by re-reading, so a withdrawal is recorded rather than the
     * row being deleted (decision G4).
     */
    withdrawnAt: timestamp({ precision: 3 }),
    /**
     * Brief 102: an `author: 'provider'` entry matched to a record of ours. Null until the matcher
     * assessed it; the union is mirrored in `@auxx/lib` `accounting/provider-matches/client.ts`.
     */
    matchState: text().$type<'pending' | 'suggested' | 'matched' | 'unmatchable'>(),
    matchReason: text(),
    /** `money_transaction` | `payout` | `invoice` — what `matchedId` names. */
    matchedKind: text(),
    /** The match when `matched`, the candidate when `suggested`. */
    matchedId: text(),
    /** User id when a person accepted or matched; null for the matcher. */
    matchedBy: text(),
    matchedAt: timestamp({ precision: 3 }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('ProviderLedgerEntry_txn_key').on(
      table.organizationId,
      table.bookId,
      table.providerTxnType,
      table.providerTxnId
    ),
    index('ProviderLedgerEntry_range_idx').on(table.organizationId, table.bookId, table.txnDate),
    index('ProviderLedgerEntry_author_idx').on(table.organizationId, table.bookId, table.author),
    index('ProviderLedgerEntry_open_match_idx')
      .on(table.organizationId, table.matchState)
      .where(sql`${table.matchState} IN ('pending', 'suggested', 'unmatchable')`),
    index('ProviderLedgerEntry_matched_idx').on(table.organizationId, table.matchedId),
  ]
)

export const ProviderLedgerLine = pgTable(
  'ProviderLedgerLine',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    entryId: text()
      .notNull()
      .references((): AnyPgColumn => ProviderLedgerEntry.id, { onDelete: 'cascade' }),
    /** Their account id, carried down from the report's section header. Never ours. */
    providerAccountId: text().notNull(),
    /** Their rendering of the account, for messages. Never used to join. */
    providerAccountName: text(),
    direction: text().$type<'debit' | 'credit'>().notNull(),
    amountMinor: bigint({ mode: 'number' }).notNull(),
    providerCustomerId: text(),
    providerVendorId: text(),
    memo: text(),
    sortOrder: bigint({ mode: 'number' }).notNull().default(0),
    raw: jsonb(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [index('ProviderLedgerLine_entry_idx').on(table.entryId)]
)

export type ProviderLedgerEntryRow = typeof ProviderLedgerEntry.$inferSelect
export type CreateProviderLedgerEntryInput = typeof ProviderLedgerEntry.$inferInsert
export type ProviderLedgerLineRow = typeof ProviderLedgerLine.$inferSelect
export type CreateProviderLedgerLineInput = typeof ProviderLedgerLine.$inferInsert
