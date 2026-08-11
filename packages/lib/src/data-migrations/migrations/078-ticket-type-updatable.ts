// packages/lib/src/data-migrations/migrations/078-ticket-type-updatable.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-078')

/**
 * The seeded help text, cleared only where it still matches verbatim so an
 * org that somehow re-worded it keeps its own copy.
 */
const STALE_DESCRIPTION = 'Ticket type cannot be changed after creation'

/**
 * Make a ticket's `type` editable after creation.
 *
 * **Why the registry flag alone is not enough.** `TICKET_FIELDS.type` shipped
 * with `updatable: false` in the initial commit, and the entity seeder maps that
 * capability onto the `CustomField.isUpdatable` column
 * (`entity-seeder/utils.ts` → `mapCapabilities`). At read time
 * `mergeSystemAndCustomFields` spreads the **DB** row's capabilities and
 * overrides only `hidden` from the static registry — `updatable` is projected
 * straight from `isUpdatable`. So flipping the registry only reaches orgs seeded
 * *after* the change; `create-fields.ts` inserts and never updates, so a re-seed
 * does not catch existing orgs up either. This pass flips the column.
 *
 * **Why it was wrong.** The flag was only ever advisory: the write path does not
 * read `capabilities.updatable` (see `field-hooks/register-hooks.ts`), `ticket`
 * is commented out of `CRUD_RESOURCE_CONFIGS`, and the record dialog filters its
 * field list on `creatable` — so the dialog has always written `type` on edit
 * while the table cell, property panel and kanban card refused to. The intent is
 * that applying a different type to an existing ticket is allowed, so the flag
 * goes rather than the four surfaces that honour it.
 *
 * **Scoped to the system field.** Matched on `systemAttribute = 'ticket_type'`,
 * which is the seeded identity of this field on every org's `ticket` def. A
 * business's own SINGLE_SELECT named "Type" carries a NULL `systemAttribute` and
 * is untouched, as is `stock_movement_type`, whose immutability is a separate
 * question — a movement's type is arguably the record.
 *
 * **Cache clear is required and is ours.** Unlike the entity-migration runner,
 * the data-migration runner does not invalidate org caches, and `customFields` /
 * `resources` are cached per org. Without the flush, every org already holding a
 * warm blob keeps serving `updatable: false` until the key expires.
 *
 * **The help text goes too.** `mergeSystemAndCustomFields` does not re-take
 * `description` from the static registry either, so the seeded
 * "Ticket type cannot be changed after creation" string lives in the DB and
 * renders next to the field. Dropping it from `TICKET_FIELDS` alone would leave
 * every existing org reading a caption that contradicts the control beside it.
 *
 * Idempotent: the `WHERE` only matches rows still sitting at `false` or still
 * carrying the stale caption, so a re-run after a partial failure updates
 * nothing. Small and unbatched on purpose — this is one row per organization,
 * not a table scan.
 */
export const migration078TicketTypeUpdatable: DataMigrationDef = {
  id: '078-ticket-type-updatable',
  description: 'Allow a ticket’s type to be changed after creation (CustomField.isUpdatable)',
  async run(db: Database): Promise<void> {
    const result = await db.execute<{ organizationId: string }>(sql`
      UPDATE "CustomField"
      SET
        "isUpdatable" = true,
        "description" = CASE
          WHEN "description" = ${STALE_DESCRIPTION} THEN NULL
          ELSE "description"
        END,
        "updatedAt" = now()
      WHERE "systemAttribute" = 'ticket_type'
        AND ("isUpdatable" = false OR "description" = ${STALE_DESCRIPTION})
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

    logger.info('Ticket type is now updatable', {
      fieldsUpdated: result.rows.length,
      organizationsAffected: organizationIds.length,
    })
  },
}
