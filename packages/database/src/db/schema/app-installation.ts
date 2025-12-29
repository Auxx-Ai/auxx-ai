// packages/database/src/db/schema/app-installation.ts
// Drizzle table for app installation

import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from './_shared'
import { createId } from '@paralleldrive/cuid2'
import { App } from './app'
import { Organization } from './organization'
import { AppVersion } from './app-version'

/** Drizzle table for AppInstallation */
export const AppInstallation = pgTable(
  'AppInstallation',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    appId: text()
      .notNull()
      .references((): AnyPgColumn => App.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    // Installation type
    installationType: text().notNull(), // 'development' | 'production'

    // Currently installed version
    currentVersionId: text()
      .references((): AnyPgColumn => AppVersion.id, { onUpdate: 'cascade', onDelete: 'set null' }),

    // Installation metadata
    installedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    uninstalledAt: timestamp({ precision: 3 }),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('AppInstallation_unique_idx').using(
      'btree',
      table.appId.asc().nullsLast(),
      table.organizationId.asc().nullsLast(),
      table.installationType.asc().nullsLast()
    ),
    index('AppInstallation_appId_idx').using('btree', table.appId.asc().nullsLast()),
    index('AppInstallation_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
  ]
)
