// packages/database/src/db/schema/money-source-link.ts
import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, foreignKey, pgTable, text, timestamp, unique } from './_shared'
import { FinancialSourceObject } from './financial-source-object'
import { MoneyCommand } from './money-command'
import { MoneyTransaction } from './money-transaction'
import { Organization } from './organization'

/** Durable MoneySourceLink owner; organization deletion cascades, scoped financial references preserve history. */
export const MoneySourceLink = pgTable(
  'MoneySourceLink',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sourceObjectId: text().notNull(),
    moneyTransactionId: text().notNull(),
    verifiedByCommandId: text().notNull(),
    linkedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('MoneySourceLink_org_id_key').on(t.organizationId, t.id),
    foreignKey({
      name: 'MoneySourceLink_sourceObjectId_fk',
      columns: [t.organizationId, t.sourceObjectId],
      foreignColumns: [FinancialSourceObject.organizationId, FinancialSourceObject.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'MoneySourceLink_moneyTransactionId_fk',
      columns: [t.organizationId, t.moneyTransactionId],
      foreignColumns: [MoneyTransaction.organizationId, MoneyTransaction.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'MoneySourceLink_verifiedByCommandId_fk',
      columns: [t.organizationId, t.verifiedByCommandId],
      foreignColumns: [MoneyCommand.organizationId, MoneyCommand.id],
    }).onDelete('no action'),
    unique('MoneySourceLink_object_key').on(t.organizationId, t.sourceObjectId),
  ]
)
