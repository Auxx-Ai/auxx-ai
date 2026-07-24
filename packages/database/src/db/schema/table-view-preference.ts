// packages/database/src/db/schema/table-view-preference.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, jsonb, pgTable, text, timestamp, unique } from './_shared'
import { Organization } from './organization'
import { TableView } from './table-view'
import { User } from './user'

/**
 * Per-user presentation preferences layered over an unnamed table or a named
 * shared view. Query semantics (sorting/filters) intentionally stay out of this
 * record so preferences cannot silently rewrite a shared view definition.
 */
export const TableViewPreference = pgTable(
  'TableViewPreference',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    tableId: text().notNull(),
    tableViewId: text().references((): AnyPgColumn => TableView.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    config: jsonb().notNull(),
    userId: text()
      .notNull()
      .references((): AnyPgColumn => User.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    unique('TableViewPreference_org_user_table_view_key')
      .on(table.organizationId, table.userId, table.tableId, table.tableViewId)
      .nullsNotDistinct(),
    index('TableViewPreference_user_organization_idx').using(
      'btree',
      table.userId.asc().nullsLast(),
      table.organizationId.asc().nullsLast()
    ),
    index('TableViewPreference_tableViewId_idx').using(
      'btree',
      table.tableViewId.asc().nullsLast()
    ),
  ]
)

/** Selected TableViewPreference entity type. */
export type TableViewPreferenceEntity = typeof TableViewPreference.$inferSelect
