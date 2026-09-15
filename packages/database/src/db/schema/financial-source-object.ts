// packages/database/src/db/schema/financial-source-object.ts
import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, foreignKey, pgTable, text, timestamp, unique } from './_shared'
import { FinancialSourceAccount } from './financial-source-account'
import { Organization } from './organization'

/** Durable FinancialSourceObject owner; organization deletion cascades, scoped financial references preserve history. */
export const FinancialSourceObject = pgTable(
  'FinancialSourceObject',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sourceAccountId: text().notNull(),
    objectType: text().notNull(),
    externalId: text().notNull(),
    componentKey: text().notNull().default(''),
  },
  (t) => [
    unique('FinancialSourceObject_org_id_key').on(t.organizationId, t.id),
    foreignKey({
      name: 'FinancialSourceObject_sourceAccountId_fk',
      columns: [t.organizationId, t.sourceAccountId],
      foreignColumns: [FinancialSourceAccount.organizationId, FinancialSourceAccount.id],
    }).onDelete('no action'),
    unique('FinancialSourceObject_identity_key').on(
      t.organizationId,
      t.sourceAccountId,
      t.objectType,
      t.externalId,
      t.componentKey
    ),
  ]
)
