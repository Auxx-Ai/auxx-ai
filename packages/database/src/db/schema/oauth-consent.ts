// packages/database/src/db/schema/oauth-consent.ts
// OAuth user consent records for OIDC Provider

import { pgTable, text, boolean, timestamp, type AnyPgColumn } from './_shared'
import { createId } from '@paralleldrive/cuid2'
import { User } from './user'

/** OAuth user consent records */
export const oauthConsent = pgTable('oauthConsent', {
  id: text()
    .$defaultFn(() => createId())
    .primaryKey()
    .notNull(),
  userId: text()
    .notNull()
    .references((): AnyPgColumn => User.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
  // clientId can be either a reference to oauthApplication or a trusted client ID
  // For trusted clients (configured in code), there's no DB record, so no FK constraint
  clientId: text().notNull(),
  scopes: text().notNull(),
  consentGiven: boolean().notNull(),
  createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
})
