// packages/database/src/db/schema/financial-source-observation.ts
import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, foreignKey, jsonb, pgTable, text, timestamp, unique } from './_shared'
import { FinancialSourceObject } from './financial-source-object'
import { Organization } from './organization'

/** Durable FinancialSourceObservation owner; organization deletion cascades, scoped financial references preserve history. */
export const FinancialSourceObservation = pgTable(
  'FinancialSourceObservation',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sourceObjectId: text().notNull(),
    contentHash: text().notNull(),
    providerVersion: text(),
    observedAt: timestamp({ withTimezone: true }).notNull(),
    payload: jsonb().notNull(),
    reportingInstallationSnapshot: jsonb().notNull(),
  },
  (t) => [
    unique('FinancialSourceObservation_org_id_key').on(t.organizationId, t.id),
    foreignKey({
      name: 'FinancialSourceObservation_sourceObjectId_fk',
      columns: [t.organizationId, t.sourceObjectId],
      foreignColumns: [FinancialSourceObject.organizationId, FinancialSourceObject.id],
    }).onDelete('no action'),
    unique('FinancialSourceObservation_hash_key').on(
      t.organizationId,
      t.sourceObjectId,
      t.contentHash
    ),
  ]
)
