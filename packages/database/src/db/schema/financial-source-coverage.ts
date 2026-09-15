// packages/database/src/db/schema/financial-source-coverage.ts
import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
} from './_shared'
import { FinancialSourceAccount } from './financial-source-account'
import { Organization } from './organization'

/** Durable FinancialSourceCoverage owner; organization deletion cascades, scoped financial references preserve history. */
export const FinancialSourceCoverage = pgTable(
  'FinancialSourceCoverage',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sourceAccountId: text().notNull(),
    streamKey: text().notNull(),
    windowKey: text().notNull(),
    requestedBoundary: jsonb().notNull(),
    fetchedBoundary: jsonb().notNull(),
    fetchedCount: integer().notNull(),
    acceptedCount: integer().notNull(),
    rejectedCount: integer().notNull(),
    pendingCount: integer().notNull(),
    complete: boolean().notNull().default(false),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('FinancialSourceCoverage_org_id_key').on(t.organizationId, t.id),
    foreignKey({
      name: 'FinancialSourceCoverage_sourceAccountId_fk',
      columns: [t.organizationId, t.sourceAccountId],
      foreignColumns: [FinancialSourceAccount.organizationId, FinancialSourceAccount.id],
    }).onDelete('no action'),
    unique('FinancialSourceCoverage_window_key').on(
      t.organizationId,
      t.sourceAccountId,
      t.streamKey,
      t.windowKey
    ),
    check(
      'FinancialSourceCoverage_counts_check',
      sql`${t.fetchedCount} >= 0 AND ${t.acceptedCount} >= 0 AND ${t.rejectedCount} >= 0 AND ${t.pendingCount} >= 0 AND ${t.acceptedCount} + ${t.rejectedCount} + ${t.pendingCount} = ${t.fetchedCount} AND (NOT ${t.complete} OR (${t.pendingCount} = 0 AND ${t.rejectedCount} = 0))`
    ),
  ]
)
