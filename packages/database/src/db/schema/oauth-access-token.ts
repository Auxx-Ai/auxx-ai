// packages/database/src/db/schema/oauth-access-token.ts
// OAuth access and refresh tokens for OIDC Provider

import { pgTable, text, timestamp, type AnyPgColumn } from './_shared'
import { createId } from '@paralleldrive/cuid2'
import { User } from './user'

/** OAuth access and refresh tokens */
export const oauthAccessToken = pgTable('oauthAccessToken', {
  id: text()
    .$defaultFn(() => createId())
    .primaryKey()
    .notNull(),
  accessToken: text().notNull().unique(),
  refreshToken: text().notNull().unique(),
  accessTokenExpiresAt: timestamp({ precision: 3 }).notNull(),
  refreshTokenExpiresAt: timestamp({ precision: 3 }).notNull(),
  userId: text()
    .notNull()
    .references((): AnyPgColumn => User.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
  // clientId can be either a reference to oauthApplication or a trusted client ID
  // For trusted clients (configured in code), there's no DB record, so no FK constraint
  clientId: text().notNull(),
  scopes: text().notNull(),
  createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
})
