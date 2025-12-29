// packages/database/src/db/schema/oauth-application.ts
// OAuth application registrations (clients) for OIDC Provider

import { pgTable, text, boolean, timestamp, type AnyPgColumn } from './_shared'
import { createId } from '@paralleldrive/cuid2'
import { User } from './user'

/** OAuth application (client) registrations */
export const oauthApplication = pgTable('oauthApplication', {
  id: text()
    .$defaultFn(() => createId())
    .primaryKey()
    .notNull(),
  clientId: text().notNull().unique(),
  clientSecret: text(),
  name: text().notNull(),
  icon: text(),

  redirectURLs: text().notNull(),
  metadata: text(),
  type: text().notNull(),
  disabled: boolean().notNull().default(false),
  userId: text().references((): AnyPgColumn => User.id, {
    onUpdate: 'cascade',
    onDelete: 'cascade',
  }),
  createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
})
