// packages/database/src/db/schema/app-setting.ts
// Drizzle table for app settings

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, jsonb, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { AppInstallation } from './app-installation'
import { AppVersion } from './app-version'

/** Drizzle table for AppSetting */
export const AppSetting = pgTable(
  'AppSetting',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    appInstallationId: text()
      .notNull()
      .references((): AnyPgColumn => AppInstallation.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    appVersionId: text().references((): AnyPgColumn => AppVersion.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    key: text().notNull(),
    value: jsonb().notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('AppSetting_appInstallationId_key_key').using(
      'btree',
      table.appInstallationId.asc().nullsLast(),
      table.key.asc().nullsLast()
    ),
    index('AppSetting_appInstallationId_idx').using(
      'btree',
      table.appInstallationId.asc().nullsLast()
    ),
    index('AppSetting_appVersionId_idx').using('btree', table.appVersionId.asc().nullsLast()),
  ]
)
