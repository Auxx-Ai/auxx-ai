// packages/lib/src/data-migrations/migrations/097-part-sku-unique.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-097')

/**
 * Enforce uniqueness on a part's SKU for orgs whose seed predates the fix.
 *
 * **The drift.** `PART_FIELDS.sku` has always declared
 * `capabilities.unique: true` and the description "Stock Keeping Unit - must be
 * unique", and the entity seeder maps that onto `CustomField.isUnique`. The
 * seeder was corrected on 2026-04-08, but `create-fields.ts` inserts and never
 * updates, so a re-seed does not catch existing orgs up: every org created
 * before that date still carries `isUnique = false`. In the dev fleet the split
 * is exactly 14/14 on the date boundary.
 *
 * **Why it mattered.** Until D6, `mergeSystemAndCustomFields` derived the
 * resource's `isIdentifier` from this column alone, so in the drifted orgs SKU
 * was not offered as an import match key at all — the wizard's only option was
 * `Record ID`, which no supplier CSV carries. Re-importing a parts file created
 * a second copy of every row instead of updating it, which is how `DemoOrg1`
 * ended up with two `m400l` and two `m400r`.
 *
 * D6 already fixed the *identifier* half by promoting `isIdentifier` from the
 * static registry. This pass fixes the *constraint* half, so a second record
 * claiming a live SKU is refused at the write path rather than merely
 * discouraged in the picker.
 *
 * **Scoped through EntityDefinition.** Matched on `entityType = 'part'` joined
 * to the field's def, not on `systemAttribute` alone: the attribute column is
 * free text and a drifted or hand-created row elsewhere carrying `part_sku`
 * must not be swept up.
 *
 * **Guarded per org, deliberately.** Flipping the flag does not retro-fail
 * existing duplicates, but it makes the NEXT write to either row throw
 * `UniqueValueConflictError` — a landmine planted in data the migration never
 * looked at. The `NOT EXISTS` skips any org whose part SKUs are not already
 * distinct, and the skipped orgs are logged with their duplicate values so the
 * cleanup is a known task rather than a support ticket months later. The dev
 * fleet is clean at time of writing, but "clean in dev" is not evidence about
 * anywhere else.
 *
 * The duplicate probe mirrors the constraint it is protecting:
 * `checkUniqueValueTyped` compares `valueText` with a bare `eq` (case- and
 * whitespace-sensitive) and excludes archived instances via its
 * `EntityInstance` join. Grouping any more loosely here would skip orgs the
 * constraint would in fact have accepted.
 *
 * **Cache clear is required and is ours.** The data-migration runner does not
 * invalidate org caches, and `customFields` / `resources` are cached per org —
 * without the flush a warm org keeps serving `unique: false` until the key
 * expires.
 *
 * **Not `vendor_part_vendor_sku`.** A vendor SKU is the supplier's own part
 * number: unique *within that supplier*, never org-wide. `checkUniqueValueTyped`
 * takes no entity or relationship scope (see its docblock — the scope was
 * removed because a mismatched predicate silently emptied the query), so marking
 * it unique would make supplier A's "A100" block supplier B's "A100". Vendor
 * part identity is the `(part, supplier)` pair, and `vendorSku` is payload.
 *
 * Idempotent: the `WHERE` only matches rows still sitting at `false`, so a
 * re-run after a partial failure updates nothing. One row per organization, so
 * unbatched on purpose.
 */
export const migration097PartSkuUnique: DataMigrationDef = {
  id: '097-part-sku-unique',
  description: 'Enforce unique part SKUs on orgs seeded before the 2026-04-08 seeder fix',
  async run(db: Database): Promise<void> {
    // Report first: the same predicate the UPDATE will skip on, so the log names
    // every org left behind rather than leaving a silent gap in the counts.
    const skipped = await db.execute<{
      organizationId: string
      duplicates: number
      samples: string[]
    }>(sql`
      SELECT
        cf."organizationId",
        count(*)::int AS duplicates,
        (array_agg(dupes."valueText" ORDER BY dupes."valueText"))[1:5] AS samples
      FROM "CustomField" cf
      JOIN "EntityDefinition" ed ON ed.id = cf."entityDefinitionId"
      JOIN LATERAL (
        SELECT fv."valueText"
        FROM "FieldValue" fv
        JOIN "EntityInstance" ei ON ei.id = fv."entityId"
        WHERE fv."fieldId" = cf.id
          AND ei."archivedAt" IS NULL
          AND fv."valueText" IS NOT NULL
        GROUP BY fv."valueText"
        HAVING count(*) > 1
      ) AS dupes ON true
      WHERE ed."entityType" = 'part'
        AND cf."systemAttribute" = 'part_sku'
        AND cf."isUnique" = false
      GROUP BY cf."organizationId"
    `)

    for (const row of skipped.rows) {
      logger.warn('Skipped org with duplicate part SKUs — resolve then re-run this migration', {
        organizationId: row.organizationId,
        duplicateSkus: row.duplicates,
        samples: row.samples,
      })
    }

    const result = await db.execute<{ organizationId: string }>(sql`
      UPDATE "CustomField" cf
      SET "isUnique" = true, "updatedAt" = now()
      FROM "EntityDefinition" ed
      WHERE ed.id = cf."entityDefinitionId"
        AND ed."entityType" = 'part'
        AND cf."systemAttribute" = 'part_sku'
        AND cf."isUnique" = false
        AND NOT EXISTS (
          SELECT 1
          FROM "FieldValue" fv
          JOIN "EntityInstance" ei ON ei.id = fv."entityId"
          WHERE fv."fieldId" = cf.id
            AND ei."archivedAt" IS NULL
            AND fv."valueText" IS NOT NULL
          GROUP BY fv."valueText"
          HAVING count(*) > 1
        )
      RETURNING cf."organizationId"
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

    logger.info('Part SKU uniqueness enforced', {
      fieldsUpdated: result.rows.length,
      organizationsAffected: organizationIds.length,
      organizationsSkipped: skipped.rows.length,
    })
  },
}
