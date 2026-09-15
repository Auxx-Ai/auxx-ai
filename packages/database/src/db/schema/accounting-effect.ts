// packages/database/src/db/schema/accounting-effect.ts

import { createId } from '@paralleldrive/cuid2'
import type { PgTableExtraConfigValue } from 'drizzle-orm/pg-core'
import {
  type AnyPgColumn,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
} from './_shared'
import { AccountingWorkBasis } from './accounting-work-basis'
import { GlPosting } from './gl-posting'
import { Organization } from './organization'

/** Durable AccountingEffect identity for accounting acceptance and recovery. */
export const AccountingEffect = pgTable(
  'AccountingEffect',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    workId: text().notNull(),
    basisVersion: integer().notNull(),
    glPostingId: text().notNull(),
    effectiveDate: date().notNull(),
    currency: text().notNull(),
    currencyExponent: integer().notNull(),
    acceptedBasis: jsonb().notNull(),
    basisHash: text().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('AccountingEffect_org_id_key').on(t.organizationId, t.id),
    unique('AccountingEffect_org_work_key').on(t.organizationId, t.workId),
    foreignKey({
      name: 'AccountingEffect_basis_scope_fk',
      columns: [t.organizationId, t.workId, t.basisVersion],
      foreignColumns: [
        AccountingWorkBasis.organizationId,
        AccountingWorkBasis.workId,
        AccountingWorkBasis.version,
      ],
    }).onDelete('no action'),
    foreignKey({
      name: 'AccountingEffect_posting_scope_fk',
      columns: [t.organizationId, t.glPostingId],
      foreignColumns: [GlPosting.organizationId, GlPosting.id],
    }).onDelete('no action'),
    check(
      'AccountingEffect_version_check',
      sql`${t.basisVersion} > 0 AND ${t.currencyExponent} BETWEEN 0 AND 9`
    ),
    check('AccountingEffect_currency_check', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('AccountingEffect_hash_check', sql`${t.basisHash} ~ '^[0-9a-f]{64}$'`),
    index('AccountingEffect_posting_idx').on(t.organizationId, t.glPostingId),
  ]
)

export type AccountingEffectEntity = typeof AccountingEffect.$inferSelect
