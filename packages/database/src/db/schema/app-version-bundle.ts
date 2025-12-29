// packages/database/src/db/schema/app-version-bundle.ts
// Drizzle table for app version bundle

import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  type AnyPgColumn,
} from './_shared'
import { createId } from '@paralleldrive/cuid2'
import { AppVersion } from './app-version'

/** Drizzle table for AppVersionBundle */
export const AppVersionBundle = pgTable(
  'AppVersionBundle',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    appVersionId: text()
      .notNull()
      .references((): AnyPgColumn => AppVersion.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    // Version type discriminator (matches parent AppVersion)
    versionType: text().notNull(), // 'dev' | 'prod'

    // S3 storage keys
    clientBundleS3Key: text(),
    serverBundleS3Key: text(),

    // Upload URLs (presigned)
    clientBundleUploadUrl: text(),
    serverBundleUploadUrl: text(),

    // Upload status
    clientBundleUploaded: boolean().default(false),
    serverBundleUploaded: boolean().default(false),

    // SHA-256 hash for bundle integrity verification (combined hash of both bundles)
    bundleSha: text(),

    // Completion status
    isComplete: boolean().default(false),
    completedAt: timestamp({ precision: 3 }),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('AppVersionBundle_appVersionId_idx').using(
      'btree',
      table.appVersionId.asc().nullsLast()
    ),
    index('AppVersionBundle_versionType_idx').using(
      'btree',
      table.versionType.asc().nullsLast()
    ),
  ]
)
