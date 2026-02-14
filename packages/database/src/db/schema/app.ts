// packages/database/src/db/schema/app.ts
// Drizzle table for app

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { DeveloperAccount } from './developer-account'
import { oauthApplication } from './oauth-application'

/** Drizzle table for App */
export const App = pgTable(
  'App',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    developerAccountId: text()
      .notNull()
      .references((): AnyPgColumn => DeveloperAccount.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    // Basic info
    slug: text().unique().notNull(),
    title: text().notNull(),
    description: text(),

    // Avatar
    avatarId: text(),
    avatarUrl: text(),

    // Marketplace listing
    category: text(), // analytics, autonomous, billing, etc.
    websiteUrl: text(),
    documentationUrl: text(),
    contactUrl: text(),
    supportSiteUrl: text(),
    termsOfServiceUrl: text(),

    // Content
    overview: text(),
    contentOverview: text(),
    contentHowItWorks: text(),
    contentConfigure: text(),

    // Permissions
    scopes: jsonb().$type<string[]>().default([]),

    // OAuth - link to Better Auth oauthApplication
    hasOauth: boolean().default(false),
    oauthApplicationId: text().references((): AnyPgColumn => oauthApplication.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    oauthExternalEntrypointUrl: text(),

    // Bundle
    hasBundle: boolean().default(false),

    // Publication state (binary: is it live in marketplace?)
    publicationStatus: text().notNull().default('unpublished'), // 'unpublished' | 'published'

    // Review workflow state (where in review process?)
    reviewStatus: text(), // null | 'pending-review' | 'in-review' | 'approved' | 'rejected' | 'withdrawn'

    // Auto-approve flag (bypasses manual review)
    autoApprove: boolean().notNull().default(false),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('App_slug_idx').using('btree', table.slug.asc().nullsLast()),
    index('App_developerAccountId_idx').using('btree', table.developerAccountId.asc().nullsLast()),
    index('App_reviewStatus_idx').using('btree', table.reviewStatus.asc().nullsLast()),
    index('App_autoApprove_idx').using('btree', table.autoApprove.asc().nullsLast()),
  ]
)
