// packages/database/src/db/schema/app-storage.ts
// Drizzle table for app KV storage (durable per-app/per-connection key-value store)

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, jsonb, pgTable, text, timestamp, unique } from './_shared'
import { AppInstallation } from './app-installation'
import { Credential } from './credential'

/**
 * Durable KV store for installed apps. One row per `(appInstallationId,
 * connectionId, collection, key)`. Backs `@auxx/sdk/server` `storage`:
 * watch registries, bearer-token caches, dropdown caches, webhook idempotency.
 *
 * Cleanup is FK-driven: uninstall cascades via `appInstallationId`, disconnect
 * cascades via `connectionId`. TTL'd rows are swept by `appStorageSweepJob`.
 */
export const AppStorage = pgTable(
  'AppStorage',
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
    // null = installation scope; set = connection scope. FK cascade means
    // disconnecting an account wipes that account's namespace automatically.
    connectionId: text().references((): AnyPgColumn => Credential.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    // '' = plain top-level key; named = entry in a collection (e.g. 'watch').
    collection: text().notNull().default(''),
    key: text().notNull(),
    value: jsonb().notNull(),
    // null = no expiry (durable state). Set = cache entry (lazy-expired on read,
    // swept in bulk by the maintenance job).
    expiresAt: timestamp({ precision: 3 }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // NULLS NOT DISTINCT so install-scoped rows (connectionId null) can't
    // duplicate per key. Requires PG 15+ (Railway pgvector qualifies). This
    // unique also serves get/upsert and list (leading-column prefix scan on
    // install → connection → collection).
    unique('AppStorage_install_connection_collection_key_key')
      .on(table.appInstallationId, table.connectionId, table.collection, table.key)
      .nullsNotDistinct(),
    index('AppStorage_appInstallationId_idx').using(
      'btree',
      table.appInstallationId.asc().nullsLast()
    ),
    index('AppStorage_connectionId_idx').using('btree', table.connectionId.asc().nullsLast()),
    // Sweep job scan.
    index('AppStorage_expiresAt_idx').using('btree', table.expiresAt.asc().nullsLast()),
  ]
)
