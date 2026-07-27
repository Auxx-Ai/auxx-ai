// packages/lib/src/data-migrations/migrations/051-google-app-scope-alignment.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-051')

/** Target scope sets for the first-party Google app connection definitions. */
const GOG_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
]

const GOG_SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
]

/**
 * Align the first-party Google app ConnectionDefinition rows with the scope set declared
 * for the prod client's Google OAuth verification (see
 * plans/google-oauth-verification-progress.md, round-2 action list). These rows share the
 * prod platform client, so every scope they request at runtime must string-match the
 * Cloud Console Data Access declaration:
 *
 * - gog-calendar: drop FULL `auth/calendar` (undeclared, sensitive — the live scope
 *   discrepancy Trust & Safety flagged) in favor of `calendar.events` + `calendar.readonly`.
 *   `calendar.readonly` covers its calendarList picker, freeBusy availability tool, and
 *   calendar metadata reads; `calendar.events` covers event CRUD + watch.
 * - gog-sheets: add `drive.metadata.readonly` so its list-spreadsheets action (Drive
 *   `files.list`) works under the app's own grant — the 2026-07-20 fix only landed on the
 *   `googleOAuth2Api` platform def, never on this row (old step 4b). Existing connections
 *   must be reconnected to pick the scope up.
 * - gog-contacts: NULL the platform client columns. `auth/contacts` is sensitive and NOT
 *   part of the verification; with no platform client the connect gate becomes
 *   `requiresOwnClient` (`resolveOwnClientRequirement` → 'no-platform-client'), so the
 *   scope can no longer be requested on the prod client. Re-enter the client in the app
 *   builder if gog-contacts should rejoin the platform client post-verification (then the
 *   `contacts` scope must be declared + justified with Google first).
 *
 * Scope edits only affect FUTURE consents — already-granted tokens keep their scopes
 * until the user reconnects. Idempotent: deterministic UPDATEs keyed on App.slug.
 */
export const migration051GoogleAppScopeAlignment: DataMigrationDef = {
  id: '051-google-app-scope-alignment',
  description:
    'Align gog-calendar/gog-sheets scopes with the Google verification set; pull gog-contacts off the platform client',
  async run(db: Database): Promise<void> {
    const calendar = await db.execute(sql`
      UPDATE "ConnectionDefinition" cd
         SET "oauth2Scopes" = ${JSON.stringify(GOG_CALENDAR_SCOPES)}::jsonb
        FROM "App" a
       WHERE cd."appId" = a."id"
         AND a."slug" = 'gog-calendar'
         AND cd."connectionType" = 'oauth2-code'
    `)
    const sheets = await db.execute(sql`
      UPDATE "ConnectionDefinition" cd
         SET "oauth2Scopes" = ${JSON.stringify(GOG_SHEETS_SCOPES)}::jsonb
        FROM "App" a
       WHERE cd."appId" = a."id"
         AND a."slug" = 'gog-sheets'
         AND cd."connectionType" = 'oauth2-code'
    `)
    const contacts = await db.execute(sql`
      UPDATE "ConnectionDefinition" cd
         SET "oauth2ClientId" = NULL,
             "oauth2ClientSecret" = NULL
        FROM "App" a
       WHERE cd."appId" = a."id"
         AND a."slug" = 'gog-contacts'
         AND cd."connectionType" = 'oauth2-code'
    `)
    logger.info('Aligned Google app connection definition scopes', {
      calendarRows: (calendar as { rowCount?: number | null }).rowCount ?? 0,
      sheetsRows: (sheets as { rowCount?: number | null }).rowCount ?? 0,
      contactsRows: (contacts as { rowCount?: number | null }).rowCount ?? 0,
    })
  },
}
