// packages/database/src/db/schema/app-deployment.ts
// Immutable deployment snapshot. Each row represents "this code was deployed at this time."

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, jsonb, pgTable, text, timestamp } from './_shared'
import { App } from './app'
import { AppBundle } from './app-bundle'
import { Organization } from './organization'

/** Drizzle table for AppDeployment */
export const AppDeployment = pgTable(
  'AppDeployment',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    appId: text()
      .notNull()
      .references((): AnyPgColumn => App.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    deploymentType: text().notNull(), // 'development' | 'production'

    // Bundle references (FK to content-addressed bundle rows)
    clientBundleId: text()
      .notNull()
      .references((): AnyPgColumn => AppBundle.id),
    serverBundleId: text()
      .notNull()
      .references((): AnyPgColumn => AppBundle.id),

    // Build output
    settingsSchema: jsonb().$type<{
      organization?: Record<string, any>
      user?: Record<string, any>
    }>(),

    // Dev-only fields
    targetOrganizationId: text().references((): AnyPgColumn => Organization.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    environmentVariables: jsonb().$type<Record<string, string>>(),

    // Production version label (e.g. "1.3.0", "2.0.0-beta.1")
    // Null for development deployments.
    version: text(),

    // Lifecycle status — single state machine for the full publication lifecycle.
    // Dev deployments are always 'active'. Prod deployments progress through the pipeline.
    // States: 'active' | 'pending-review' | 'in-review' | 'approved' | 'rejected' | 'withdrawn' | 'published' | 'deprecated'
    status: text().notNull().default('active'),

    // Review metadata (set when status transitions through review states)
    reviewedAt: timestamp({ precision: 3 }),
    reviewedBy: text(),
    rejectionReason: text(),
    releaseNotes: text(),

    // Metadata
    metadata: jsonb().$type<{
      cliVersion?: string
      commitSha?: string
      message?: string
    }>(),
    createdById: text(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('AppDeployment_appId_idx').on(table.appId),
    index('AppDeployment_type_idx').on(table.appId, table.deploymentType),
    index('AppDeployment_targetOrganizationId_idx').on(table.targetOrganizationId),
  ]
)
