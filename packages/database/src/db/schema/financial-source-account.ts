// packages/database/src/db/schema/financial-source-account.ts
import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, check, pgTable, sql, text, timestamp, unique } from './_shared'
import { Organization } from './organization'

/** Durable FinancialSourceAccount owner; organization deletion cascades, scoped financial references preserve history. */
export const FinancialSourceAccount = pgTable(
  'FinancialSourceAccount',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    providerKey: text().notNull(),
    externalAccountId: text().notNull(),
    environment: text().notNull(),
    archivedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique('FinancialSourceAccount_org_id_key').on(t.organizationId, t.id),
    unique('FinancialSourceAccount_identity_key').on(
      t.organizationId,
      t.providerKey,
      t.externalAccountId,
      t.environment
    ),
    check(
      'FinancialSourceAccount_identity_check',
      sql`length(${t.providerKey}) > 0 AND length(${t.externalAccountId}) > 0 AND ${t.environment} IN ('live', 'test')`
    ),
  ]
)
