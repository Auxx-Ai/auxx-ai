// packages/database/src/db/schema/gl-posting-source.ts
// The link table between a posting and what it was written FOR, and the claim
// that makes a double post unrepresentable. See plans/accounting/TARGET.md §1.

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, pgTable, sql, text, timestamp, uniqueIndex } from './_shared'
import { GlPosting } from './gl-posting'
import { Organization } from './organization'

/**
 * How a source relates to the posting.
 *
 * `subject` is what the entry is OF and is the claim. `parent` lets an order
 * list its fulfillment, receipt and refund postings in one query. `member` names
 * what a posting summed - the movements behind a COGS entry, the receipts inside
 * a bank deposit. `pending` is a DRAFT's subject: the claim it will take when
 * posted, outside the claim index so the record can find its draft.
 */
export const GL_POSTING_LINK_ROLES = [
  'subject',
  'parent',
  'counterparty',
  'member',
  'pending',
] as const
export type GlPostingLinkRole = (typeof GL_POSTING_LINK_ROLES)[number]

export const GlPostingSource = pgTable(
  'GlPostingSource',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    glPostingId: text()
      .notNull()
      .references((): AnyPgColumn => GlPosting.id, { onDelete: 'cascade' }),
    /** `'fulfillment' | 'invoice' | 'money_transaction' | 'stock_movement' | 'gl_posting' | …` */
    sourceKind: text().notNull(),
    sourceId: text().notNull(),
    linkRole: text().$type<GlPostingLinkRole>().notNull(),
    /**
     * Which pass over the same source this is: `'original'`, `'reversal'`, or a
     * write-off / application id for the repeatable actions.
     */
    occurrence: text().notNull().default('original'),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // ── THE CLAIM. One live subject per source per occurrence. A reversal
    // deletes the original's subject row so the source can post again. ──
    uniqueIndex('GlPostingSource_claim_key')
      .on(table.organizationId, table.sourceKind, table.sourceId, table.occurrence)
      .where(sql`${table.linkRole} = 'subject'`),
    index('GlPostingSource_source_idx').on(table.organizationId, table.sourceKind, table.sourceId),
    index('GlPostingSource_posting_idx').on(table.glPostingId),
  ]
)

export type GlPostingSourceEntity = typeof GlPostingSource.$inferSelect
export type CreateGlPostingSourceInput = typeof GlPostingSource.$inferInsert
