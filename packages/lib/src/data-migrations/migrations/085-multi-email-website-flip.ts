// packages/lib/src/data-migrations/migrations/085-multi-email-website-flip.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-085')

/**
 * The seeded system attributes this migration flips to multi-value storage.
 * Contact `phone` is DELIBERATELY absent — multi-phone waits on the E.164
 * normalization plan (`plans/records/phone-e164-normalization-plan.md`); the
 * naive US-only normalizer would reject international aliases at write.
 */
export const MULTI_FLIP_SYSTEM_ATTRIBUTES = ['primary_email', 'company_website'] as const

/**
 * Merge `multi: true` into a CustomField `options` blob without clobbering
 * whatever else the org's row carries (display options, validation, provider
 * config, …). Non-object blobs (null, arrays, scalars from legacy writes) are
 * replaced with a fresh object — there is nothing mergeable to preserve.
 */
export function mergeMultiIntoOptions(options: unknown): Record<string, unknown> {
  const base =
    options && typeof options === 'object' && !Array.isArray(options)
      ? (options as Record<string, unknown>)
      : {}
  return { ...base, multi: true }
}

/**
 * Flip contact `primary_email` and company `website` to multi-value storage
 * (`options.multi`) on existing orgs.
 *
 * **Why the registry flag alone is not enough.** `CONTACT_FIELDS.primaryEmail`
 * and `COMPANY_FIELDS.website` gained `options: { multi: true }`, and the
 * entity seeder merges registry options onto `CustomField.options` — but only
 * for orgs seeded AFTER the change (`create-fields.ts` inserts and never
 * updates). Existing orgs keep `multi` unset, so their fields stay
 * single-value: reads return scalars, `validateAndConvertValue` rejects array
 * writes, and the picker/renderer array branches never engage. Same mechanism
 * as migration 084.
 *
 * **Options are merged, never clobbered.** Each row's existing `options` jsonb
 * (display options, validation, …) is preserved; only the `multi` key is
 * added ({@link mergeMultiIntoOptions}).
 *
 * **Scoped to the system fields.** Matched on `systemAttribute`, the seeded
 * identity of these fields on every org's def. Org-created EMAIL/URL fields
 * carry a NULL `systemAttribute` and are untouched. Contact `phone` is NOT
 * flipped (see {@link MULTI_FLIP_SYSTEM_ATTRIBUTES}).
 *
 * **Existing scalar values need no rewrite.** A multi field with one stored
 * row is already the valid one-element state; reads on `options.multi` fields
 * return arrays regardless of count.
 *
 * **Cache clear is required and is ours.** The data-migration runner does not
 * invalidate org caches, and `customFields` / `resources` are cached per org.
 * Without the flush, orgs holding a warm blob keep serving single-value field
 * metadata until the key expires.
 *
 * Idempotent: the `WHERE` only matches rows whose options don't carry
 * `multi: true` yet.
 */
export const migration085MultiEmailWebsiteFlip: DataMigrationDef = {
  id: '085-multi-email-website-flip',
  description: 'Flip contact primary_email and company website to multi-value (options.multi)',
  async run(db: Database): Promise<void> {
    const pending = await db.execute<{
      id: string
      organizationId: string
      options: unknown
    }>(sql`
      SELECT "id", "organizationId", "options"
      FROM "CustomField"
      WHERE "systemAttribute" IN (${sql.join(
        MULTI_FLIP_SYSTEM_ATTRIBUTES.map((attr) => sql`${attr}`),
        sql`, `
      )})
        AND ("options" IS NULL OR "options"->>'multi' IS DISTINCT FROM 'true')
    `)

    for (const row of pending.rows) {
      const merged = mergeMultiIntoOptions(row.options)
      await db.execute(sql`
        UPDATE "CustomField"
        SET "options" = ${JSON.stringify(merged)}::jsonb, "updatedAt" = now()
        WHERE "id" = ${row.id}
      `)
    }

    const organizationIds = [...new Set(pending.rows.map((r) => r.organizationId))]

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

    logger.info('primary_email and company_website are now multi-value', {
      fieldsUpdated: pending.rows.length,
      organizationsAffected: organizationIds.length,
    })
  },
}
