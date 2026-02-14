// packages/database/src/db/schema/app-version.ts
// Drizzle table for app version

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, integer, jsonb, pgTable, text, timestamp } from './_shared'
import { App } from './app'
import { DeveloperAccountMember } from './developer-account-member'
import { Organization } from './organization'

/** Drizzle table for AppVersion */
export const AppVersion = pgTable(
  'AppVersion',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    appId: text()
      .notNull()
      .references((): AnyPgColumn => App.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    // Version type discriminator
    versionType: text().notNull(), // 'dev' | 'prod'

    // Version number
    major: integer().notNull(),
    minor: integer().default(0),
    patch: integer().default(0),

    // Dev-specific fields
    targetOrganizationId: text().references((): AnyPgColumn => Organization.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    environmentVariables: jsonb().$type<Record<string, string>>(),

    // Prod-specific fields
    // Publication state (binary: is it live in marketplace?)
    publicationStatus: text().notNull().default('unpublished'), // 'unpublished' | 'published'

    // Review workflow state (where in review process?)
    reviewStatus: text(), // null | 'pending-review' | 'in-review' | 'approved' | 'rejected' | 'withdrawn'
    reviewedAt: timestamp({ precision: 3 }),
    reviewedBy: text(), // Admin user ID who approved/rejected
    rejectionReason: text(), // If rejected, why?

    numInstallations: integer().default(0),
    releasedAt: timestamp({ precision: 3 }),

    // Common fields
    status: text().default('draft'), // 'draft' | 'active' | 'deprecated'
    cliVersion: text(),
    releaseNotes: text(),

    // Settings schema captured during bundle execution
    settingsSchema: jsonb()
      .$type<{
        organization?: Record<string, any>
        user?: Record<string, any>
      }>()
      .default({ organization: {}, user: {} }),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    createdById: text().references((): AnyPgColumn => DeveloperAccountMember.id, {
      onUpdate: 'cascade',
    }),
  },
  (table) => [
    index('AppVersion_appId_idx').using('btree', table.appId.asc().nullsLast()),
    index('AppVersion_versionType_idx').using('btree', table.versionType.asc().nullsLast()),
    index('AppVersion_reviewStatus_idx').using('btree', table.reviewStatus.asc().nullsLast()),
  ]
)
