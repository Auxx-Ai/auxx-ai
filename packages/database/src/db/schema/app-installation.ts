// packages/database/src/db/schema/app-installation.ts
// Drizzle table for app installation

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, pgTable, sql, text, timestamp, uniqueIndex } from './_shared'
import { App } from './app'
import { AppDeployment } from './app-deployment'
import { Organization } from './organization'

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

    // Currently deployed version
    currentDeploymentId: text().references((): AnyPgColumn => AppDeployment.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    // Installation metadata
    installedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    uninstalledAt: timestamp({ precision: 3 }),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // ONE live installation per app per organization.
    //
    // This used to be a plain unique over (appId, organizationId,
    // installationType), which permitted a `development` and a `production`
    // installation of the same app side by side. They are not two views of one
    // app: `AppSetting`, `Credential`, `DataConnector`, `CustomField` and
    // `RecordIdentity` are all keyed by `appInstallationId`, so a second row is
    // a second, near-empty copy of the app's state. `pnpm sync-dev` created one
    // next to an installed production app, the settings page wrote `allowWrites`
    // to production, and the workflow engine executed the block as development —
    // which then refused the write it had just been granted.
    //
    // `installationType` stays on the row (it records what the current
    // deployment is, and the UI shows it) but is no longer part of identity, so
    // switching an installation between a dev and a published deployment is a
    // repoint rather than a second row.
    //
    // Partial, on `uninstalledAt IS NULL`: soft-deleted rows are history and
    // several may accumulate for one app. Only live rows are constrained.
    uniqueIndex('AppInstallation_live_unique_idx')
      .using('btree', table.appId.asc().nullsLast(), table.organizationId.asc().nullsLast())
      .where(sql`"uninstalledAt" IS NULL`),
    index('AppInstallation_appId_idx').using('btree', table.appId.asc().nullsLast()),
    index('AppInstallation_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
  ]
)
