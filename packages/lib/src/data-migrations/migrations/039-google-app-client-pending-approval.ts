// packages/lib/src/data-migrations/migrations/039-google-app-client-pending-approval.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-039')

/**
 * Bring app-owned Google OAuth connections (the first-party `gog-sheets` / `gog-calendar` /
 * `gog-contacts` apps, and any future Google app) under the same own-client gate as the
 * platform providers. Their `ConnectionDefinition` rows share the Google OAuth app that's
 * pending verification, but `platformClientApproved` has never been written for app rows
 * (defaults to `true`), so the connect flow forced the unverified platform client with no
 * bring-your-own escape hatch.
 *
 * Set `platformClientApproved` from the SAME env flag the platform providers use
 * (`GOOGLE_PLATFORM_CREDENTIALS_APPROVED`): `false` → the connect dialog offers platform-login
 * OR a user-supplied client (`resolveOwnClientRequirement` → `ownClientOptional`); once Google
 * verification completes and the flag flips, re-running promotes these rows back to approved.
 *
 * Idempotent: a scoped UPDATE keyed on app-owned Google `oauth2-code` rows.
 */
export const migration039GoogleAppClientPendingApproval: DataMigrationDef = {
  id: '039-google-app-client-pending-approval',
  description:
    'Set app-owned Google OAuth rows to platformClientApproved per GOOGLE_PLATFORM_CREDENTIALS_APPROVED',
  async run(db: Database): Promise<void> {
    const approved = process.env.GOOGLE_PLATFORM_CREDENTIALS_APPROVED !== 'false'
    const result = await db.execute(sql`
      UPDATE "ConnectionDefinition"
         SET "platformClientApproved" = ${approved}
       WHERE "appId" IS NOT NULL
         AND "connectionType" = 'oauth2-code'
         AND "oauth2AuthorizeUrl" ILIKE '%accounts.google.com%'
    `)
    logger.info('Set platformClientApproved on app-owned Google OAuth rows', {
      approved,
      rowCount: (result as { rowCount?: number | null }).rowCount ?? 0,
    })
  },
}
