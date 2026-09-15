// packages/database/src/db/schema/external-accounting-book.ts
import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, check, pgTable, sql, text, timestamp, unique } from './_shared'
import { Organization } from './organization'

/** Durable ExternalAccountingBook identity for accounting acceptance and recovery. */
export const ExternalAccountingBook = pgTable(
  'ExternalAccountingBook',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    providerKey: text().notNull(),
    externalCompanyId: text().notNull(),
  },
  (t) => [
    unique('ExternalAccountingBook_org_id_key').on(t.organizationId, t.id),
    unique('ExternalAccountingBook_company_key').on(
      t.organizationId,
      t.providerKey,
      t.externalCompanyId
    ),
    check(
      'ExternalAccountingBook_identity_check',
      sql`length(${t.providerKey}) > 0 AND length(${t.externalCompanyId}) > 0`
    ),
  ]
)

export type ExternalAccountingBookEntity = typeof ExternalAccountingBook.$inferSelect
