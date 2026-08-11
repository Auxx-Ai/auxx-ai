// packages/lib/src/data-migrations/migrations/079-enrichment-fields-backend-owned.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-079')

/** The company enrichment markers, written by the enrichment job and nothing else. */
const BACKEND_OWNED_ATTRIBUTES = ['company_enriched_at', 'company_enrichment_status']

/**
 * Mark the company enrichment fields as not user-updatable.
 *
 * **This changes nothing visible today, on purpose.** Both fields carry
 * `hidden: true` in `COMPANY_FIELDS`, and `hidden` is the one capability
 * `mergeSystemAndCustomFields` re-takes from the static registry — so they are
 * already filtered off every surface (the dialogs gate on
 * `!capabilities?.hidden`) no matter what the DB row says. This closes the gap
 * underneath that: `isUpdatable` is `true` on every existing row, and `updatable`
 * IS read from the DB, so the day someone unhides these to show enrichment state
 * on a company record they would come back user-editable in every org that
 * already exists.
 *
 * That is exactly how ticket `type` went wrong (`078`): a capability that only
 * ever lived in one place, disagreed with the other, and was never enforced by
 * the write path. The enrichment job is unaffected — the write path does not read
 * `capabilities.updatable` at all (`field-hooks/register-hooks.ts`), so this
 * constrains the UI and nothing else.
 *
 * **Not folded into `078`.** That migration is already recorded as applied in
 * environments that have booted since it landed, and the runner skips an applied
 * id — extending it in place would silently never run there.
 *
 * Scoped by `systemAttribute`, so a business's own field named "Enriched At"
 * (NULL `systemAttribute`) is untouched. Idempotent: the `WHERE` only matches
 * rows still sitting at `true`.
 */
export const migration079EnrichmentFieldsBackendOwned: DataMigrationDef = {
  id: '079-enrichment-fields-backend-owned',
  description: 'Mark company enrichment markers as backend-owned (CustomField.isUpdatable = false)',
  async run(db: Database): Promise<void> {
    const result = await db.execute<{ organizationId: string }>(sql`
      UPDATE "CustomField"
      SET "isUpdatable" = false, "updatedAt" = now()
      WHERE "systemAttribute" IN (${sql.join(
        BACKEND_OWNED_ATTRIBUTES.map((attribute) => sql`${attribute}`),
        sql`, `
      )})
        AND "isUpdatable" = true
      RETURNING "organizationId"
    `)

    const organizationIds = [...new Set(result.rows.map((r) => r.organizationId))]

    if (organizationIds.length > 0) {
      // Lazy so the data-migration graph does not pull the cache barrel (and its
      // Redis client) into every migration run.
      const { getOrgCache } = await import('../../cache')
      const cache = getOrgCache()
      await Promise.all(
        organizationIds.map((organizationId) =>
          cache.invalidateAndRecompute(organizationId, ['customFields', 'resources'])
        )
      )
    }

    logger.info('Company enrichment markers are now backend-owned', {
      fieldsUpdated: result.rows.length,
      organizationsAffected: organizationIds.length,
    })
  },
}
