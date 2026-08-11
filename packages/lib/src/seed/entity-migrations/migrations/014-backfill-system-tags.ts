// packages/lib/src/seed/entity-migrations/migrations/014-backfill-system-tags.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import { and, eq, inArray } from 'drizzle-orm'
import { TAG_FIELDS } from '../../../resources/registry/resources/tag-fields'
import { buildFieldOptions, mapCapabilities } from '../../entity-seeder/utils'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:014')

/**
 * Frozen-in-time snapshot of the titles `OrganizationSeeder.seedTags` creates.
 * If the seeder's defaults change later, do NOT edit this list — write a new
 * migration that flags the new titles. Migrations are historical.
 *
 * ⚠️ It has already drifted, deliberately. `seedTags` now creates only `Urgent`
 * and `VIP` as system tags: data migration `076` retired the rest (plan 06 §5.1
 * / Q6), so seeding them would make every new org need that migration. Eleven of
 * the titles below therefore describe orgs created before 2026-08-10 and nothing
 * else — which is exactly what a historical migration should describe. Syncing
 * this list to the current seeder would be the bug, not the fix.
 */
const CANONICAL_SYSTEM_TAG_TITLES = [
  // Parent
  'Topic Categorization',
  // Children of "Topic Categorization"
  'Account Management',
  'Billing',
  'Customer Feedback',
  'Legal',
  'Sales',
  'Security',
  'Shipping',
  'Troubleshooting',
  // Independent
  'Support',
  'Urgent',
  'Orders',
  'VIP',
]

/**
 * Migration 014: Backfill `is_system_tag` for existing orgs.
 *
 * Two steps, both idempotent:
 *   1. Ensure a `CustomField` row with `systemAttribute = 'is_system_tag'`
 *      exists on the org's `tag` EntityDefinition.
 *   2. For every tag instance whose `title` is in the canonical seeded list,
 *      upsert the `is_system_tag` FieldValue to `true`.
 *
 * New orgs get `is_system_tag = true` directly from the seeder; this
 * migration catches up the orgs seeded before the system-tags PR.
 *
 * Title-match risk: a user-created tag that happens to share a canonical
 * title (e.g. "Billing") will be flagged as a system tag and locked down
 * in the UI. Accepted per product decision — low user count, low impact.
 */
export const migration014BackfillSystemTags: EntityMigration = {
  id: '014-backfill-system-tags',
  description: 'Ensure tag.is_system_tag CustomField and flag canonical seeded tags',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    // ── Step 0: find the tag EntityDefinition for this org ────────────────
    const [tagDef] = await db
      .select({ id: schema.EntityDefinition.id })
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, organizationId),
          eq(schema.EntityDefinition.entityType, 'tag')
        )
      )
      .limit(1)

    if (!tagDef) {
      // No tag entity — nothing to migrate. Pre-seed or manually pruned.
      return { ...state, alreadyUpToDate: true }
    }

    // ── Step 1: ensure the is_system_tag CustomField exists ───────────────
    const isSystemTagFieldId = await ensureIsSystemTagField(db, organizationId, tagDef.id, state)

    // ── Step 2: flag canonical tags ───────────────────────────────────────
    const { flagged, alreadyFlagged } = await flagCanonicalTags(
      db,
      organizationId,
      tagDef.id,
      isSystemTagFieldId
    )

    const alreadyUpToDate = state.fieldsCreated === 0 && flagged === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 014 applied', {
        organizationId,
        customFieldCreated: state.fieldsCreated > 0,
        tagsFlagged: flagged,
        tagsAlreadyFlagged: alreadyFlagged,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}

/**
 * Insert the is_system_tag CustomField if missing. Returns the field id.
 */
async function ensureIsSystemTagField(
  db: Database,
  organizationId: string,
  tagDefId: string,
  state: { fieldsCreated: number }
): Promise<string> {
  const field = TAG_FIELDS.is_system_tag
  if (!field) {
    throw new Error('TAG_FIELDS.is_system_tag is missing from the registry')
  }

  const [existing] = await db
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, tagDefId),
        eq(schema.CustomField.systemAttribute, 'is_system_tag')
      )
    )
    .limit(1)

  if (existing) return existing.id

  const [created] = await db
    .insert(schema.CustomField)
    .values({
      organizationId,
      entityDefinitionId: tagDefId,
      modelType: 'tag',
      name: field.label,
      type: field.fieldType!,
      description: field.description,
      systemAttribute: field.systemAttribute as SystemAttribute,
      sortOrder: field.systemSortOrder ?? 'a8',
      options: buildFieldOptions(field),
      isCustom: false,
      updatedAt: new Date(),
      ...mapCapabilities(field.capabilities),
    })
    .returning({ id: schema.CustomField.id })

  if (!created) throw new Error('Failed to create tag.is_system_tag CustomField')

  state.fieldsCreated++
  logger.debug('Created tag.is_system_tag CustomField', {
    id: created.id,
    organizationId,
  })
  return created.id
}

/**
 * Drop any tag carrying `tag_ai_classify = true` from the flag set.
 *
 * ⚠️ **Added 2026-08-10 — this migration is replayed, not ledger-guarded.**
 * `runEntityMigrationsForOrg` loops `ALL_MIGRATIONS` and calls `up()`
 * unconditionally every time (`entity-migrations/index.ts:231-233`);
 * `alreadyUpToDate` is a REPORT, not a guard. Both it and
 * `runAllEntityMigrations` are exposed as super-admin actions
 * (`admin.ts:1563-1583`).
 *
 * Three of this migration's canonical titles — `Billing`, `Sales`, `Support` —
 * are also mail-classification starter tags, which are deliberately ORDINARY
 * tags (`05-mail-classification-plan.md` C4/§2.3) because
 * `rejectIfSystemTag` freezes `tag_description`, and that description IS the
 * classifier's instruction for the label. Without this exclusion, one replay
 * would flag the starters by title, permanently freeze their instructions, and
 * report success while doing it.
 *
 * Matching on title alone cannot tell a legacy system tag from a starter that
 * happens to share its name; the eligibility flag is the only thing that can.
 * Absent field or absent row ⇒ not eligible ⇒ flagged as before, so this is a
 * no-op for every org that predates the field.
 */
async function excludeAiClassifyTags(
  db: Database,
  organizationId: string,
  tagDefId: string,
  instanceIds: string[]
): Promise<string[]> {
  const [aiClassifyField] = await db
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, tagDefId),
        eq(schema.CustomField.systemAttribute, 'tag_ai_classify')
      )
    )
    .limit(1)

  // Field not materialized yet (every org before migration 074) — nothing is
  // eligible, so the original behavior stands.
  if (!aiClassifyField) return instanceIds

  const eligibleRows = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, aiClassifyField.id),
        eq(schema.FieldValue.valueBoolean, true),
        inArray(schema.FieldValue.entityId, instanceIds)
      )
    )

  if (eligibleRows.length === 0) return instanceIds

  const eligible = new Set(eligibleRows.map((r) => r.entityId))
  const kept = instanceIds.filter((id) => !eligible.has(id))

  logger.info('Skipped AI-eligible tags during system-tag backfill', {
    organizationId,
    skipped: instanceIds.length - kept.length,
  })

  return kept
}

/**
 * Upsert `is_system_tag = true` on every tag instance whose title matches
 * the canonical seeded list. Returns counts for logging.
 */
async function flagCanonicalTags(
  db: Database,
  organizationId: string,
  tagDefId: string,
  isSystemTagFieldId: string
): Promise<{ flagged: number; alreadyFlagged: number }> {
  // Resolve the title fieldId on this org's tag entity.
  const [titleField] = await db
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, tagDefId),
        eq(schema.CustomField.systemAttribute, 'title')
      )
    )
    .limit(1)

  if (!titleField) {
    // Tag entity exists but has no title field — structural problem, not
    // ours to fix. Bail gracefully.
    logger.warn('No title CustomField on tag entity; skipping flag step', { organizationId })
    return { flagged: 0, alreadyFlagged: 0 }
  }

  // Find canonical-titled tag instances.
  const canonicalRows = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, titleField.id),
        inArray(schema.FieldValue.valueText, CANONICAL_SYSTEM_TAG_TITLES)
      )
    )

  if (canonicalRows.length === 0) {
    return { flagged: 0, alreadyFlagged: 0 }
  }

  const canonicalInstanceIds = await excludeAiClassifyTags(
    db,
    organizationId,
    tagDefId,
    canonicalRows.map((r) => r.entityId)
  )

  if (canonicalInstanceIds.length === 0) {
    return { flagged: 0, alreadyFlagged: 0 }
  }

  // Find which ones already have an is_system_tag FieldValue row.
  const existingFlagRows = await db
    .select({
      id: schema.FieldValue.id,
      entityId: schema.FieldValue.entityId,
      valueBoolean: schema.FieldValue.valueBoolean,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, isSystemTagFieldId),
        inArray(schema.FieldValue.entityId, canonicalInstanceIds)
      )
    )

  const existingByEntity = new Map(existingFlagRows.map((r) => [r.entityId, r]))

  const idsToFlip: string[] = []
  const instancesToInsert: string[] = []
  let alreadyFlagged = 0

  for (const entityId of canonicalInstanceIds) {
    const existing = existingByEntity.get(entityId)
    if (!existing) {
      instancesToInsert.push(entityId)
    } else if (existing.valueBoolean === true) {
      alreadyFlagged++
    } else {
      idsToFlip.push(existing.id)
    }
  }

  const now = new Date()

  if (idsToFlip.length > 0) {
    await db
      .update(schema.FieldValue)
      .set({ valueBoolean: true, updatedAt: now })
      .where(inArray(schema.FieldValue.id, idsToFlip))
  }

  if (instancesToInsert.length > 0) {
    await db.insert(schema.FieldValue).values(
      instancesToInsert.map((entityId) => ({
        organizationId,
        entityId,
        entityDefinitionId: tagDefId,
        fieldId: isSystemTagFieldId,
        sortKey: generateKeyBetween(null, null),
        valueBoolean: true,
        updatedAt: now,
      }))
    )
  }

  return {
    flagged: idsToFlip.length + instancesToInsert.length,
    alreadyFlagged,
  }
}
