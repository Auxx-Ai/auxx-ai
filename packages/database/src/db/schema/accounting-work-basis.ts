// packages/database/src/db/schema/accounting-work-basis.ts

import { createId } from '@paralleldrive/cuid2'
import type { PgTableExtraConfigValue } from 'drizzle-orm/pg-core'
import {
  type AnyPgColumn,
  check,
  date,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
} from './_shared'
import { AccountingWork } from './accounting-work'
import { Organization } from './organization'

/** Durable AccountingWorkBasis identity for accounting acceptance and recovery. */
export const AccountingWorkBasis = pgTable(
  'AccountingWorkBasis',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    workId: text().notNull(),
    version: integer().notNull(),
    sourceHash: text().notNull(),
    effectiveDate: date(),
    basis: jsonb().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('AccountingWorkBasis_org_id_key').on(t.organizationId, t.id),
    unique('AccountingWorkBasis_org_work_version_key').on(t.organizationId, t.workId, t.version),
    foreignKey({
      name: 'AccountingWorkBasis_work_scope_fk',
      columns: [t.organizationId, t.workId],
      foreignColumns: [AccountingWork.organizationId, AccountingWork.id],
    }).onDelete('no action'),
    check('AccountingWorkBasis_version_check', sql`${t.version} > 0`),
    check('AccountingWorkBasis_hash_check', sql`${t.sourceHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'AccountingWorkBasis_ready_date_check',
      sql`((${t.basis}->>'status' = 'incomplete') OR (${t.basis}->>'status' = 'ready' AND ${t.effectiveDate} IS NOT NULL)) IS TRUE`
    ),
  ]
)

export type AccountingWorkBasisEntity = typeof AccountingWorkBasis.$inferSelect
