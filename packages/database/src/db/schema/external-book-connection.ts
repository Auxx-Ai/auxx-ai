// packages/database/src/db/schema/external-book-connection.ts
import { createId } from '@paralleldrive/cuid2'
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
  uniqueIndex,
} from './_shared'
import { Credential } from './credential'
import { ExternalAccountingBook } from './external-accounting-book'
import { Organization } from './organization'

/** Durable ExternalBookConnection identity for accounting acceptance and recovery. */
export const ExternalBookConnection = pgTable(
  'ExternalBookConnection',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    bookId: text().notNull(),
    epoch: integer().notNull(),
    credentialId: text(),
    credentialOrganizationId: text(),
    credentialBindingSnapshot: text().notNull(),
    state: text().notNull().$type<'active' | 'disconnected' | 'retired'>(),
    exportFromDate: date().notNull(),
    openingPolicy: jsonb().notNull(),
  },
  (t) => [
    unique('ExternalBookConnection_org_id_key').on(t.organizationId, t.id),
    unique('ExternalBookConnection_epoch_key').on(t.organizationId, t.bookId, t.epoch),
    uniqueIndex('ExternalBookConnection_active_key')
      .on(t.organizationId)
      .where(sql`${t.state} = 'active'`),
    foreignKey({
      name: 'ExternalBookConnection_book_scope_fk',
      columns: [t.organizationId, t.bookId],
      foreignColumns: [ExternalAccountingBook.organizationId, ExternalAccountingBook.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'ExternalBookConnection_credential_scope_fk',
      columns: [t.credentialOrganizationId, t.credentialId],
      foreignColumns: [Credential.organizationId, Credential.id],
    }).onDelete('set null'),
    check(
      'ExternalBookConnection_credential_check',
      sql`(${t.credentialId} IS NULL AND ${t.credentialOrganizationId} IS NULL) OR (${t.credentialId} IS NOT NULL AND ${t.credentialOrganizationId} IS NOT NULL AND ${t.credentialOrganizationId} = ${t.organizationId})`
    ),
    check(
      'ExternalBookConnection_state_check',
      sql`${t.state} IN ('active', 'disconnected', 'retired') AND ${t.epoch} > 0`
    ),
  ]
)

export type ExternalBookConnectionEntity = typeof ExternalBookConnection.$inferSelect
