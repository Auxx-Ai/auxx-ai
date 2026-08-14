// packages/lib/src/data-migrations/migrations/086-multi-phone-flip.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'
import { mergeMultiIntoOptions } from './085-multi-email-website-flip'

const logger = createScopedLogger('migration-086')

/**
 * The seeded system attribute this migration flips to multi-value storage.
 *
 * Split out from 085's list rather than folded into it: 085 has already run on
 * every environment, and a data migration is applied once — extending its
 * attribute list would silently no-op for existing orgs.
 */
export const MULTI_PHONE_SYSTEM_ATTRIBUTE = 'phone'

/**
 * The seeded `EntityDefinition.entityType` this migration is scoped to.
 *
 * Unlike 085's `primary_email` / `company_website`, the attribute name `phone`
 * is generic enough that ORG-CREATED definitions use it too — a dev-DB check
 * found `leads` and `vendors` defs carrying `systemAttribute = 'phone'`. Those
 * are user-created (`entityType IS NULL`) and appear in no field registry, so
 * flipping them would leave existing orgs multi-value while any newly created
 * such def stays scalar — a permanent divergence, and exactly the mismatch this
 * migration exists to prevent. `entityType` is the seeder's own key
 * (`create-entity-defs.ts` writes it from `SYSTEM_ENTITIES`) and is the same
 * key `FIELD_REGISTRY` uses to decide the field is `CONTACT_FIELDS.phone`.
 */
export const MULTI_PHONE_ENTITY_TYPE = 'contact'

/**
 * Flip contact `phone` to multi-value storage (`options.multi`) on existing
 * orgs — the last single-value identity field, held back until E.164
 * normalization landed (PR #1629).
 *
 * Mechanically identical to {@link migration085MultiEmailWebsiteFlip}; see that
 * file for why the registry flag alone is not enough (`create-fields.ts`
 * inserts and never updates, so existing orgs keep `multi` unset and their
 * fields stay single-value), why options are merged rather than clobbered, and
 * why the org cache flush is this migration's responsibility.
 *
 * **Scoped to the system field ON THE CONTACT DEF.** Matched on
 * `systemAttribute = 'phone'` AND `EntityDefinition.entityType = 'contact'` —
 * see {@link MULTI_PHONE_ENTITY_TYPE} for why the attribute alone is too broad
 * here (it is not, for 085's attributes). Org-created PHONE_INTL fields carry a
 * NULL `systemAttribute` and are untouched either way.
 *
 * **No value reshape, and none is needed.** A multi field with one stored row
 * is already the valid one-element state. The prod audit
 * (`plans/records/phone-e164-normalization-plan.md` §5, run 2026-08-14: 498
 * rows / 103 distinct) found 36 distinct values that fail `isValid()` and
 * **zero that renormalize to a different string** — a renormalize pass would be
 * a pure no-op. Those invalid values are seed-generator junk from before #1629;
 * they read fine and only reject if someone edits that contact's phone.
 *
 * **Deliberately no uniqueness pass.** `primary_email` needed migration 084 to
 * set `isUnique` because addresses identify one contact. Phone numbers do not —
 * households and companies share a line — so `CONTACT_FIELDS.phone` carries no
 * `unique` capability and this migration arms no gate.
 *
 * Idempotent: the `WHERE` only matches rows whose options don't carry
 * `multi: true` yet.
 */
export const migration086MultiPhoneFlip: DataMigrationDef = {
  id: '086-multi-phone-flip',
  description: 'Flip contact phone to multi-value (options.multi)',
  async run(db: Database): Promise<void> {
    const pending = await db.execute<{
      id: string
      organizationId: string
      options: unknown
    }>(sql`
      SELECT cf."id", cf."organizationId", cf."options"
      FROM "CustomField" cf
      JOIN "EntityDefinition" ed ON ed."id" = cf."entityDefinitionId"
      WHERE cf."systemAttribute" = ${MULTI_PHONE_SYSTEM_ATTRIBUTE}
        AND ed."entityType" = ${MULTI_PHONE_ENTITY_TYPE}
        AND (cf."options" IS NULL OR cf."options"->>'multi' IS DISTINCT FROM 'true')
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

    logger.info('contact phone is now multi-value', {
      fieldsUpdated: pending.rows.length,
      organizationsAffected: organizationIds.length,
    })
  },
}
