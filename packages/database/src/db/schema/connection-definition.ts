// packages/database/src/db/schema/connection-definition.ts
// Drizzle table for connection definition

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from './_shared'
import { App } from './app'
import { DeveloperAccount } from './developer-account'

/** OAuth2 feature flags and provider-specific configuration */
export type OAuth2Features = {
  /** Enable PKCE with S256 (RFC 7636) */
  pkce?: boolean
  /** Override the callback base URL (e.g. use localhost instead of NGROK). Falls back to WEBAPP_URL. */
  callbackBaseUrl?: string
  /** Static params appended to the authorize URL */
  additionalAuthorizeParams?: Record<string, string>
  /** Static params appended to the token exchange request body */
  additionalTokenParams?: Record<string, string>
  /** Scope separator character. Default: ' ' (space) */
  scopeSeparator?: string
}

/** Drizzle table for ConnectionDefinition */
export const ConnectionDefinition = pgTable(
  'ConnectionDefinition',
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
    appId: text()
      .notNull()
      .references((): AnyPgColumn => App.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    major: integer().notNull(), // Version major

    // Connection type: oauth2-code, secret, none
    connectionType: text().notNull(),
    label: text().notNull(),
    description: text(),
    global: boolean().default(false), // true = organization-wide, false = user-specific

    // OAuth2 config
    oauth2AuthorizeUrl: text(),
    oauth2AccessTokenUrl: text(),
    oauth2Scopes: jsonb().$type<string[]>().default([]),
    oauth2ClientId: text(),
    oauth2ClientSecret: text(), // Encrypted
    oauth2TokenRequestAuthMethod: text().default('request-body'), // request-body, basic-auth
    oauth2RefreshTokenIntervalSeconds: integer(),
    oauth2Features: jsonb().$type<OAuth2Features>().default({}),

    // Creator
    createdById: text().notNull(), // { id, type: 'developer-account-member' }

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('ConnectionDefinition_app_version_idx').using(
      'btree',
      table.appId.asc().nullsLast(),
      table.major.asc().nullsLast()
    ),
  ]
)
